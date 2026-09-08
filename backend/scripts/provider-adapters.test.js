/**
 * Provider adapter test — SMTP, FCM and the capability matrix. PURE, no network.
 *
 * These are the parts of the mail and push transports that must be exactly
 * right and are impossible to eyeball in a log:
 *
 *   SMTP  header injection, RFC 2047 subjects (this app sends emoji and Telugu),
 *         header folding, dot-stuffing (a body line starting with "." ends DATA
 *         early and silently discards the rest of the message), multiline reply
 *         parsing, and the AUTH command sequence.
 *   FCM   the RS256 service-account assertion (verified against the public key),
 *         the v1 message shape (data values MUST be strings — a number is a 400
 *         that reads like a credential problem), and the error classification
 *         that decides whether to retry or prune a device token.
 *   CAPS  the matrix the production guard depends on: which adapter serves which
 *         channel, and which are declared seams with no implementation.
 *
 * The socket layer itself is deliberately NOT tested here — it cannot be
 * without a server, and pretending otherwise would produce a test that asserts
 * nothing. What is asserted is every byte the socket is asked to send.
 *
 * Run: node scripts/provider-adapters.test.js
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  encodeWord, foldHeader, dotStuff, wrapBase64, buildMimeMessage,
  parseReply, smtpCommands, bareAddress, needsStartTls, advertisedAuth,
} from '../src/utils/smtpClient.js';
import {
  buildAssertion, buildMessagePayload, isTokenExpired, classifyError,
  parseServiceAccount, getAccessToken, sendPush, clearTokenCache, TOKEN_URL, SCOPE,
} from '../src/utils/fcmClient.js';
import {
  CHANNEL, OTP_PROVIDER_CHANNELS, NOTIFICATION_PROVIDER_CHANNELS,
  IMPLEMENTED, REQUIRED_OTP_CHANNELS, channelsServedBy, servesChannel,
  isImplemented, isDevOnly, isDeclaredNotImplemented, missingChannels,
  providerForChannel, checkChannelSupport,
} from '../src/utils/providerCapabilities.js';

let pass = 0;
const ok = (label) => { pass += 1; console.log(`  ✓ ${label}`); };

// One throwaway RSA keypair for the whole suite. RS256 signing requires a real
// asymmetric key, so the FCM cases (assertion AND token exchange) both need one
// — a placeholder string fails inside jsonwebtoken rather than testing anything.
const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const TEST_CLIENT_EMAIL = 'push@fm-prod.iam.gserviceaccount.com';

// ===========================================================================
// 1. RFC 2047 — the subjects this app actually sends
// ===========================================================================
{
  // The notification templates ship emoji ("Out for delivery 🚚") and stores
  // have Telugu names. A raw 8-bit subject corrupts in transit.
  assert.equal(encodeWord('Your order is confirmed'), 'Your order is confirmed', 'ASCII is left alone');
  const emoji = encodeWord('Out for delivery 🚚');
  assert.match(emoji, /^=\?UTF-8\?B\?.*\?=$/, 'non-ASCII becomes a base64 encoded-word');
  const decoded = Buffer.from(emoji.slice('=?UTF-8?B?'.length, -2), 'base64').toString('utf8');
  assert.equal(decoded, 'Out for delivery 🚚', 'the encoded-word round-trips exactly');
  ok('emoji subjects are RFC 2047 encoded and round-trip');

  const telugu = encodeWord('రోజ్ బజార్');
  assert.equal(
    Buffer.from(telugu.slice('=?UTF-8?B?'.length, -2), 'base64').toString('utf8'),
    'రోజ్ బజార్',
  );
  ok('Telugu subjects round-trip');

  // base64 ("B"), not Q-encoding ("Q"): Q expands every non-ASCII byte to =XX,
  // which for Indic text means roughly 3x the size and a hard 75-char-per-line
  // split problem. Assert the encoding is declared as B and that the payload is
  // valid base64.
  assert.ok(emoji.startsWith('=?UTF-8?B?'), 'the encoding is declared as B (base64), not Q');
  const payload = emoji.slice('=?UTF-8?B?'.length, -'?='.length);
  assert.match(payload, /^[A-Za-z0-9+/]*={0,2}$/, 'the payload is valid base64');
  // Q-encoding this string would be far longer than the base64 form
  const qLength = [...'Out for delivery 🚚'].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? Buffer.byteLength(ch, 'utf8') * 3 : 1), 0);
  assert.ok(payload.length < qLength, `base64 (${payload.length}) beats Q-encoding (${qLength}) for this text`);
  ok('base64 encoding is used — Q-encoding would expand emoji and Indic text badly');
}

// ===========================================================================
// 2. header injection — a CRLF in a value would forge headers
// ===========================================================================
{
  assert.throws(
    () => buildMimeMessage({
      from: 'a@b.in', to: 'c@d.in',
      subject: 'Hi\r\nBcc: victim@evil.com',
    }),
    /header injection/i,
  );
  assert.throws(
    () => buildMimeMessage({
      from: 'a@b.in', to: 'c@d.in', subject: 'ok',
      headers: { 'X-Custom': 'v\r\nBcc: victim@evil.com' },
    }),
    /header injection/i,
  );
  assert.throws(
    () => buildMimeMessage({ from: 'a@b.in', to: 'c@d.in\r\nBcc: x@y', subject: 'ok' }),
    /recipient contains a line break/,
  );
  ok('CRLF in subject, custom header or recipient is refused (no forged Bcc)');
}

// ===========================================================================
// 3. dot-stuffing — a body line starting with "." truncates the message
// ===========================================================================
{
  // DATA ends at a lone "." on its own line. Without stuffing, everything after
  // the first such line is silently DISCARDED by the server.
  assert.equal(dotStuff('.hidden'), '..hidden');
  assert.equal(dotStuff('line1\r\n.hidden\r\nline3'), 'line1\r\n..hidden\r\nline3');
  assert.equal(dotStuff('not.a.dot'), 'not.a.dot', 'only a LEADING dot is stuffed');
  assert.equal(dotStuff('..double'), '...double');
  assert.equal(dotStuff('unix\nline'), 'unix\r\nline', 'bare LF is normalised to CRLF');
  ok('a leading dot is stuffed, so a bulleted body cannot truncate the mail');

  const msg = buildMimeMessage({ from: 'a@b.in', to: 'c@d.in', subject: 's', text: '. starts with a dot' });
  assert.ok(!/\r\n\.(?!\.)/.test(msg.replace(/\r\n\.\r\n$/, '')), 'the built message contains no bare dot line');
  ok('buildMimeMessage dot-stuffs whatever body it is given');
}

// ===========================================================================
// 4. header folding and base64 line length
// ===========================================================================
{
  const long = 'Re: ' + 'word '.repeat(40).trim();
  const folded = foldHeader('Subject', encodeWord(long));
  assert.ok(folded.includes('\r\n'), 'a long header is folded');
  for (const line of folded.split('\r\n')) {
    assert.ok(line.length <= 78 || /^=?\?/.test(line.trim()), `line within 78 chars: ${line.length}`);
  }
  assert.ok(folded.split('\r\n').slice(1).every((l) => /^\s/.test(l)), 'continuation lines start with whitespace');
  ok('long headers fold at 78 chars with whitespace continuations');

  // An encoded-word must never be split — a break inside base64 destroys it.
  const encoded = foldHeader('Subject', encodeWord('రోజ్ బజార్ '.repeat(20)));
  assert.ok(!encoded.includes('\r\n'), 'an encoded-word is never folded mid-payload');
  ok('encoded-words are never folded (splitting base64 would corrupt them)');

  const b64 = wrapBase64('x'.repeat(400));
  assert.ok(b64.split('\r\n').every((l) => l.length <= 76), 'every base64 line <= 76 chars');
  ok('base64 bodies respect the 76-char line limit');
}

// ===========================================================================
// 5. the message as a whole
// ===========================================================================
{
  const msg = buildMimeMessage({
    from: 'Flower Market <no-reply@flowermarket.in>',
    to: 'customer@example.com',
    subject: 'Your order is confirmed',
    text: 'Thanks for your order.',
    html: '<p>Thanks for your order.</p>',
    messageId: '<fixed-id@flowermarket.in>',
    date: new Date('2026-09-08T10:00:00Z'),
  });

  assert.ok(msg.includes('From: Flower Market <no-reply@flowermarket.in>'));
  assert.ok(msg.includes('To: customer@example.com'));
  assert.ok(msg.includes('Message-ID: <fixed-id@flowermarket.in>'));
  assert.ok(msg.includes('MIME-Version: 1.0'));
  assert.ok(msg.includes('Date: Tue, 08 Sep 2026 10:00:00 +0000'));
  assert.ok(/Content-Type: multipart\/alternative; boundary="fm_alt_[0-9a-f]+"/.test(msg), 'text+html → multipart/alternative');
  assert.ok(msg.includes('\r\n\r\n'), 'headers are separated from the body by a blank line');
  assert.ok(msg.endsWith('\r\n'), 'the message is CRLF-terminated');

  // both alternatives must be present and decodable
  const parts = msg.split(/--fm_alt_[0-9a-f]+\r?\n/).filter((p) => p.includes('Content-Transfer-Encoding'));
  assert.equal(parts.length, 2, 'two alternatives');
  const decoded = parts.map((p) => {
    const body = p.split('\r\n\r\n')[1] || '';
    return Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
  });
  assert.ok(decoded.some((d) => d.includes('Thanks for your order.') && !d.includes('<p>')), 'the plain part');
  assert.ok(decoded.some((d) => d.includes('<p>Thanks for your order.</p>')), 'the html part');
  ok('a text+html message builds as decodable multipart/alternative');

  // text-only
  const textOnly = buildMimeMessage({ from: 'a@b.in', to: 'c@d.in', subject: 's', text: 'hello' });
  assert.ok(textOnly.includes('Content-Type: text/plain; charset=UTF-8'));
  assert.ok(!textOnly.includes('multipart'));
  ok('a text-only message is not needlessly multipart');

  // multiple recipients
  const multi = buildMimeMessage({ from: 'a@b.in', to: ['x@y.in', 'z@y.in'], subject: 's', text: 'h' });
  assert.ok(multi.includes('To: x@y.in, z@y.in'));
  ok('multiple recipients are joined in To:');

  // required fields
  assert.throws(() => buildMimeMessage({ to: 'c@d.in', subject: 's' }), /`from` is required/);
  assert.throws(() => buildMimeMessage({ from: 'a@b.in', to: [], subject: 's' }), /at least one `to`/);
  ok('a message with no from, or no recipient, is refused');
}

// ===========================================================================
// 6. SMTP reply parsing — reading only the first line acts on a partial answer
// ===========================================================================
{
  assert.deepEqual(parseReply('220 smtp.test ESMTP\r\n'), { complete: true, code: 220, lines: ['220 smtp.test ESMTP'], text: 'smtp.test ESMTP' });

  // A multiline 250- reply is NOT complete until a "250 " terminator arrives.
  const partial = parseReply('250-smtp.test\r\n250-SIZE 52428800\r\n250-STARTTLS\r\n');
  assert.equal(partial.complete, false, 'continuation lines mean more are coming');
  assert.equal(partial.code, 250);

  const full = parseReply('250-smtp.test\r\n250-SIZE 52428800\r\n250-STARTTLS\r\n250 AUTH LOGIN PLAIN\r\n');
  assert.equal(full.complete, true);
  assert.equal(full.code, 250);
  assert.ok(full.text.includes('STARTTLS'), 'all continuation text is joined');
  ok('a multiline reply is only complete once the terminator line arrives');

  assert.equal(parseReply('').complete, false);
  assert.equal(parseReply('250 no trailing crlf').complete, false, 'an unterminated buffer is incomplete');
  ok('a partial buffer is never mistaken for a reply');
}

// ===========================================================================
// 7. STARTTLS + AUTH negotiation
// ===========================================================================
{
  assert.equal(needsStartTls('250-smtp.test\r\n250-STARTTLS\r\n250 AUTH LOGIN', { secure: false }), true);
  assert.equal(needsStartTls('250-STARTTLS', { secure: true }), false, 'already TLS — no upgrade');
  assert.equal(needsStartTls('250 smtp.test', { secure: false }), false, 'not advertised');
  ok('STARTTLS is used only when advertised and the socket is not already secure');

  assert.deepEqual(advertisedAuth('250-smtp.test\r\n250 AUTH LOGIN PLAIN'), ['LOGIN', 'PLAIN']);
  assert.deepEqual(advertisedAuth('250-smtp.test\r\n250-AUTH=LOGIN\r\n250 SIZE 1'), ['LOGIN']);
  assert.deepEqual(advertisedAuth('250 no auth here'), []);
  ok('advertised AUTH mechanisms are read from the EHLO reply');

  assert.equal(bareAddress('Flower Market <no-reply@x.in>'), 'no-reply@x.in');
  assert.equal(bareAddress('no-reply@x.in'), 'no-reply@x.in');
  ok('MAIL FROM uses the bare address, not the display name');
}

// ===========================================================================
// 8. the command sequence — every byte the socket is asked to send
// ===========================================================================
{
  const steps = smtpCommands({
    host: 'flowermarket.in', user: 'u@x.in', pass: 'secret',
    from: 'no-reply@x.in', to: ['a@b.in', 'c@d.in'], message: 'Subject: s\r\n\r\nbody\r\n',
  });
  const sends = steps.map((s) => s.send);
  assert.equal(sends[0], 'EHLO flowermarket.in');
  assert.equal(sends[1], 'AUTH LOGIN');
  assert.equal(sends[2], Buffer.from('u@x.in').toString('base64'), 'username is base64');
  assert.equal(sends[3], Buffer.from('secret').toString('base64'), 'password is base64');
  assert.equal(sends[4], 'MAIL FROM:<no-reply@x.in>');
  assert.equal(sends[5], 'RCPT TO:<a@b.in>');
  assert.equal(sends[6], 'RCPT TO:<c@d.in>', 'one RCPT per recipient');
  assert.equal(sends[7], 'DATA');
  assert.ok(sends[8].endsWith('\r\n.'), 'DATA ends with a lone dot');
  assert.equal(sends[9], 'QUIT');
  assert.deepEqual(steps.map((s) => s.expect), [220, 334, 334, 235, 250, 250, 250, 354, 250, 221], 'each step expects its own code');
  ok('AUTH LOGIN sequence: EHLO → 334/334/235 → MAIL → RCPT×n → DATA → QUIT');

  const plain = smtpCommands({ host: 'h', user: 'u', pass: 'p', auth: 'plain', from: 'f@h', to: 't@h', message: 'm\r\n' });
  assert.equal(plain[1].send, `AUTH PLAIN ${Buffer.from('\u0000u\u0000p').toString('base64')}`);
  assert.equal(plain[1].expect, 235);
  ok('AUTH PLAIN is a single base64 NUL-delimited step');

  const anon = smtpCommands({ host: 'h', user: null, from: 'f@h', to: 't@h', message: 'm\r\n' });
  assert.ok(!anon.some((s) => s.send.startsWith('AUTH')), 'no AUTH when there is no user');
  ok('an unauthenticated relay sends no AUTH');
}

// ===========================================================================
// 9. FCM — the service-account assertion, verified against the public key
// ===========================================================================
{
  const clientEmail = TEST_CLIENT_EMAIL;
  const privateKey = TEST_PRIVATE_KEY;
  const assertion = buildAssertion({ clientEmail, privateKey, now: 1_800_000_000, expiresIn: 3600 });

  const claims = jwt.verify(assertion, TEST_PUBLIC_KEY, {
    algorithms: ['RS256'], audience: TOKEN_URL, issuer: clientEmail, ignoreExpiration: true,
  });
  assert.equal(claims.scope, SCOPE);
  assert.equal(claims.iss, clientEmail);
  assert.equal(claims.sub, clientEmail);
  assert.equal(claims.aud, TOKEN_URL, 'the assertion is scoped to the token endpoint');
  assert.equal(claims.iat, 1_800_000_000, 'the injected clock is used');
  assert.equal(claims.exp, 1_800_003_600);
  ok('the RS256 assertion verifies, with iss/sub/aud/scope and a deterministic clock');

  assert.throws(() => buildAssertion({ clientEmail: '', privateKey }), /client_email is required/);
  assert.throws(() => buildAssertion({ clientEmail, privateKey: '' }), /private_key is required/);
  ok('a missing service-account field is refused before signing');
}

// ===========================================================================
// 10. FCM v1 message shape
// ===========================================================================
{
  const payload = buildMessagePayload({
    token: 'device-token', title: 'Out for delivery 🚚', body: 'Your rider is on the way',
    data: { orderId: 'abc', qty: 3, skipMe: null, andMe: undefined },
  });
  assert.equal(payload.message.token, 'device-token');
  assert.equal(payload.message.notification.title, 'Out for delivery 🚚');
  assert.equal(payload.message.android.priority, 'high', 'a delivery push must not be deferred by Doze');

  // v1 REJECTS non-string data values with a 400 that reads like a credential
  // problem — so they are coerced here instead.
  assert.equal(payload.message.data.qty, '3', 'numbers are coerced to strings');
  assert.equal(payload.message.data.orderId, 'abc');
  assert.ok(!('skipMe' in payload.message.data), 'null is dropped, not sent as "null"');
  assert.ok(!('andMe' in payload.message.data));
  ok('v1 data values are all strings, and nulls are dropped');

  assert.throws(() => buildMessagePayload({ token: '', title: 't', body: 'b' }), /device token is required/);
  ok('a message with no device token is refused');
}

// ===========================================================================
// 11. FCM error classification — retry vs prune
// ===========================================================================
{
  const unregistered = classifyError(404, { error: { code: 'UNREGISTERED', message: 'app deleted' } });
  assert.equal(unregistered.pruneToken, true, 'a dead token must be removed from the device table');
  assert.equal(unregistered.retryable, false);

  const badToken = classifyError(400, { error: { message: 'The registration token is not a valid FCM registration token' } });
  assert.equal(badToken.pruneToken, true, 'an invalid token is pruned even without an error code');

  const unavailable = classifyError(503, { error: { code: 'UNAVAILABLE' } });
  assert.equal(unavailable.retryable, true);
  assert.equal(unavailable.pruneToken, false, 'a transient failure must NOT discard the device');

  assert.equal(classifyError(429, {}).retryable, true, 'rate limited → back off and retry');
  assert.equal(classifyError(403, { error: { code: 'SENDER_ID_MISMATCH' } }).retryable, false, 'wrong Firebase project: no retry will fix it');
  assert.equal(classifyError(403, { error: { code: 'SENDER_ID_MISMATCH' } }).pruneToken, false, 'and the token is not the problem, so do not prune it');
  assert.equal(classifyError(500, {}).code, 'HTTP_500', 'an unparseable body still yields a code');
  ok('retryable vs prune-token are decided correctly (a transient error never discards a device)');
}

// ===========================================================================
// 12. token cache + the two HTTP calls, with an injected fetch
// ===========================================================================
{
  clearTokenCache();
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url === TOKEN_URL) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.test', expires_in: 3600 }) };
    }
    return { ok: true, status: 200, json: async () => ({ name: 'projects/p/messages/123' }) };
  };
  const sa = { projectId: 'fm-prod', clientEmail: TEST_CLIENT_EMAIL, privateKey: TEST_PRIVATE_KEY };

  const first = await sendPush({ serviceAccount: sa, token: 'tk', title: 'T', body: 'B', fetchImpl: fakeFetch, now: 1_800_000_000 });
  assert.equal(first.ok, true);
  assert.equal(first.ref, 'projects/p/messages/123');
  assert.equal(calls.length, 2, 'one token exchange + one send');
  assert.equal(calls[0].init.body.includes('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'), true);

  // second send reuses the cached token — no third HTTP call
  const second = await sendPush({ serviceAccount: sa, token: 'tk', title: 'T2', body: 'B2', fetchImpl: fakeFetch, now: 1_800_000_100 });
  assert.equal(second.ok, true);
  assert.equal(calls.length, 3, 'the cached token was reused');
  assert.equal(calls[2].url, 'https://fcm.googleapis.com/v1/projects/fm-prod/messages:send');
  assert.equal(calls[2].init.headers.authorization, 'Bearer ya29.test');
  ok('the access token is exchanged once and cached across sends');

  assert.equal(isTokenExpired(1_800_003_600, 1_800_000_000), false);
  assert.equal(isTokenExpired(1_800_000_030, 1_800_000_000), true, 'expires within the 60s skew → refresh');
  assert.equal(isTokenExpired(null), true);
  ok('the token is refreshed 60s before it expires, not after');

  // a failed send returns a classified result rather than throwing, so one dead
  // device cannot abort a batch
  clearTokenCache();
  const failing = async (url) => (url === TOKEN_URL
    ? { ok: true, status: 200, json: async () => ({ access_token: 'ya29.x', expires_in: 3600 }) }
    : { ok: false, status: 404, json: async () => ({ error: { code: 'UNREGISTERED' } }) });
  const failed = await sendPush({ serviceAccount: sa, token: 'dead', title: 'T', body: 'B', fetchImpl: failing, now: 1_800_000_000 });
  assert.equal(failed.ok, false);
  assert.equal(failed.pruneToken, true);
  ok('a per-device failure returns classified (ok:false) instead of throwing');

  // a token-exchange failure DOES throw: nothing can be sent at all
  clearTokenCache();
  const noToken = async () => ({ ok: false, status: 400, json: async () => ({ error_description: 'invalid_grant' }) });
  await assert.rejects(
    () => sendPush({ serviceAccount: sa, token: 'tk', title: 'T', body: 'B', fetchImpl: noToken, now: 1_800_000_000 }),
    /token exchange failed.*invalid_grant/,
  );
  ok('a credential failure throws loudly rather than silently sending nothing');
  clearTokenCache();
}

// ===========================================================================
// 13. service-account parsing
// ===========================================================================
{
  const sa = parseServiceAccount(JSON.stringify({
    client_email: 'a@b.iam', private_key: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----', project_id: 'p',
  }));
  assert.equal(sa.projectId, 'p');
  assert.ok(sa.privateKey.includes('\n'), 'escaped \\n in Google\'s JSON becomes real newlines');
  assert.throws(() => parseServiceAccount({ client_email: 'a@b' }), /client_email, private_key and project_id/);
  // parsing does not validate the key (no signing happens here), so a
  // placeholder is the right input for this case
  ok('a Google service-account JSON is parsed and its key normalised');
}

// ===========================================================================
// 14. the capability matrix the production guard depends on
// ===========================================================================
{
  assert.deepEqual(channelsServedBy('msg91'), [CHANNEL.PHONE]);
  assert.deepEqual(channelsServedBy('twilio'), [CHANNEL.PHONE]);
  assert.deepEqual(channelsServedBy('smtp'), [CHANNEL.EMAIL]);
  assert.deepEqual(channelsServedBy('nonsense'), [], 'an unknown provider serves nothing');
  ok('msg91/twilio are phone-only, smtp is email-only');

  // THE BUG: ses was in the guard's allow-list with no implementation behind it.
  assert.equal(isDeclaredNotImplemented('otp', 'ses'), true);
  assert.equal(isImplemented('otp', 'ses'), false);
  assert.equal(isImplemented('otp', 'msg91'), true);
  assert.equal(isImplemented('otp', 'smtp'), true);
  ok('ses is flagged as a declared seam with no implementation');

  assert.equal(isDeclaredNotImplemented('notification', 'apns'), true);
  assert.equal(isDeclaredNotImplemented('search', 'atlas'), true);
  assert.equal(isDeclaredNotImplemented('search', 'opensearch'), true);
  assert.equal(isImplemented('search', 'mongo'), true, 'mongo is the real ranked index');
  ok('apns, atlas and opensearch are seams; mongo search is real');

  assert.equal(isDevOnly('otp', 'console'), true);
  assert.equal(isDevOnly('otp', 'memory'), true);
  assert.equal(isDevOnly('notification', 'mock'), true);
  assert.equal(isDevOnly('storage', 'local'), true);
  assert.equal(isDevOnly('otp', 'msg91'), false);
  ok('console/memory/mock/local are flagged as dev-only doubles');

  // console "serves" everything — which is exactly why dev-only is a separate
  // question from capability
  assert.deepEqual(missingChannels('console', REQUIRED_OTP_CHANNELS), []);
  assert.equal(isDevOnly('otp', 'console'), true);
  ok('a dev double may serve every channel and still be refused in production');

  assert.deepEqual(missingChannels('msg91', REQUIRED_OTP_CHANNELS), [CHANNEL.EMAIL]);
  assert.deepEqual(missingChannels('smtp', REQUIRED_OTP_CHANNELS), [CHANNEL.PHONE]);
  assert.deepEqual(missingChannels('console', REQUIRED_OTP_CHANNELS), []);
  ok('missingChannels names the uncovered channels, not just "failed"');

  assert.equal(providerForChannel({ channel: CHANNEL.EMAIL, phoneProvider: 'msg91', emailProvider: 'smtp' }), 'smtp');
  assert.equal(providerForChannel({ channel: CHANNEL.PHONE, phoneProvider: 'msg91', emailProvider: 'smtp' }), 'msg91');
  ok('the two OTP slots route by channel');

  assert.equal(checkChannelSupport({ provider: 'smtp', channel: CHANNEL.EMAIL }).ok, true);
  assert.match(checkChannelSupport({ provider: 'msg91', channel: CHANNEL.EMAIL }).reason, /does not serve the "email" channel/);
  assert.match(checkChannelSupport({ provider: 'ses', channel: CHANNEL.PHONE }).reason, /declared seam with no implementation/);
  assert.match(checkChannelSupport({ provider: 'nope', channel: CHANNEL.PHONE }).reason, /unknown otp provider/);
  ok('checkChannelSupport distinguishes a typo, a seam, and a channel mismatch');

  // every notification provider in the matrix must be either implemented or
  // explicitly declared — no name may be in neither list
  const unaccounted = Object.keys(NOTIFICATION_PROVIDER_CHANNELS)
    .filter((p) => !isImplemented('notification', p) && !isDeclaredNotImplemented('notification', p));
  assert.deepEqual(unaccounted, [], `unaccounted notification providers: ${unaccounted.join(', ')}`);
  const otpUnaccounted = Object.keys(OTP_PROVIDER_CHANNELS)
    .filter((p) => !isImplemented('otp', p) && !isDeclaredNotImplemented('otp', p));
  assert.deepEqual(otpUnaccounted, [], `unaccounted OTP providers: ${otpUnaccounted.join(', ')}`);
  ok('every provider name in the matrix is either implemented or explicitly a seam');
}

console.log(`\nPROVIDER ADAPTERS: all ${pass} scenarios passed ✔`);
