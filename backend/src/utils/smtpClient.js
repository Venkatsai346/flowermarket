/**
 * smtpClient.js — a dependency-free SMTP client for transactional mail.
 *
 * WHY HAND-ROLLED
 * The dependency tree has no mail library, and adding one is not free: this
 * platform sends OTPs (a login-blocking path) and order notifications, so the
 * mail transport is on the critical path and must be auditable end to end. SMTP
 * is a small, stable, line-based protocol — the whole of what we need is EHLO,
 * AUTH, MAIL FROM, RCPT TO, DATA, QUIT. What matters far more than the socket
 * work is getting the MESSAGE right: headers, folding, dot-stuffing, and RFC 2047
 * encoding for the non-ASCII subjects this app actually sends ("Out for
 * delivery 🚚", Telugu store names). A raw 8-bit subject silently corrupts in
 * transit, and that bug is invisible until a customer's OTP mail lands as
 * mojibake.
 *
 * So the file is split:
 *   PURE  buildMimeMessage / encodeWord / foldHeader / smtpCommands /
 *         parseReply / needsStartTls   — no sockets, fully unit-tested in
 *         scripts/provider-adapters.test.js
 *   THIN  sendMail()                   — the socket, STARTTLS upgrade and the
 *         read/write loop. It does nothing but move bytes the pure layer built.
 *
 * Supports implicit TLS (port 465) and STARTTLS (port 587), AUTH LOGIN and
 * AUTH PLAIN. No connection pooling: transactional volume here is OTPs and
 * order events, and a pooled socket that dies silently is worse than a fresh
 * one that fails loudly.
 */

import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

/** Anything a header value must not contain (injection vector). */
const HEADER_UNSAFE = /[\r\n]/;

/**
 * RFC 2047 encoded-word for a header value that is not pure ASCII.
 *
 * Base64 rather than Q-encoding because the subjects here are emoji and Indic
 * text, where Q-encoding expands badly (every non-ASCII byte becomes =XX).
 * Returns the input untouched when it is already ASCII-safe — no point wrapping
 * "Your order is confirmed" in encoded-word syntax.
 *
 * @param {string} value
 * @param {string} [charset]
 * @returns {string}
 */
export function encodeWord(value, charset = 'UTF-8') {
  const s = String(value ?? '');
  // A control-character range on purpose: ASCII-safe headers are sent verbatim
  // and anything else is RFC 2047 encoded. This is the one legitimate use of the
  // pattern the rule exists to question.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?${charset}?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

/**
 * Fold a long header to <=78 chars on whitespace (RFC 5322 §2.2.3).
 *
 * Unfolded long headers are rejected by strict MTAs and mangled by loose ones.
 * Never folds inside an encoded-word, because a line break there destroys the
 * base64 payload.
 */
export function foldHeader(name, value, maxWidth = 78) {
  const line = `${name}: ${value}`;
  if (line.length <= maxWidth) return line;
  // An encoded-word must stay intact — folding mid-base64 corrupts it.
  if (/=\?[^?]+\?[BQ]\?[^?]*\?=$/.test(value.trim())) return line;
  const words = String(value).split(/\s+/);
  const out = [];
  let current = `${name}:`;
  for (const w of words) {
    if (current.length + 1 + w.length > maxWidth && current !== `${name}:`) {
      out.push(current);
      current = ` ${w}`; // continuation lines start with whitespace
    } else {
      current = current === `${name}:` ? `${name}: ${w}` : `${current} ${w}`;
    }
  }
  out.push(current);
  return out.join('\r\n');
}

/**
 * Dot-stuff the message body (RFC 5321 §4.5.2).
 *
 * A line beginning with a single "." terminates DATA early — everything after
 * it is silently DISCARDED by the server. A notification body that starts a line
 * with a period (a bulleted list, say) would therefore vanish. Every such line
 * gets an extra dot, which the server strips.
 */
export function dotStuff(body) {
  return String(body ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

/**
 * Build the complete RFC 5322 message.
 *
 * PURE: same input, same bytes. Deterministic `messageId`/`date` can be injected
 * so tests can assert the exact output.
 *
 * @param {object} m
 * @param {string} m.from           "Flower Market <no-reply@flowermarket.in>"
 * @param {string|string[]} m.to
 * @param {string} m.subject        encoded if non-ASCII
 * @param {string} [m.text]         plain-text alternative
 * @param {string} [m.html]         HTML alternative
 * @param {string} [m.replyTo]
 * @param {object} [m.headers]      extra headers (values are injection-checked)
 * @param {string} [m.messageId]
 * @param {Date}   [m.date]
 * @returns {string} the message, CRLF-terminated and dot-stuffed
 */
export function buildMimeMessage({
  from, to, subject, text = null, html = null, replyTo = null,
  headers = {}, messageId = null, date = null, domain = 'localhost',
}) {
  if (!from) throw new TypeError('buildMimeMessage: `from` is required');
  const recipients = Array.isArray(to) ? to : [to];
  if (!recipients.length || recipients.some((r) => !r)) {
    throw new TypeError('buildMimeMessage: at least one `to` recipient is required');
  }
  for (const [k, v] of Object.entries({ from, subject, ...headers })) {
    if (HEADER_UNSAFE.test(String(v ?? ''))) {
      // A CRLF in a header value would let a caller inject arbitrary headers —
      // including Bcc: — into every mail this process sends.
      throw new TypeError(`buildMimeMessage: header "${k}" contains a line break (header injection)`);
    }
  }
  for (const r of recipients) {
    if (HEADER_UNSAFE.test(String(r))) throw new TypeError('buildMimeMessage: recipient contains a line break');
  }

  const mid = messageId || `<${crypto.randomUUID()}@${domain}>`;
  const when = date ? new Date(date) : new Date();

  const head = [];
  head.push(foldHeader('Date', when.toUTCString().replace(/GMT/, '+0000')));
  head.push(foldHeader('From', from));
  head.push(foldHeader('To', recipients.join(', ')));
  if (replyTo) head.push(foldHeader('Reply-To', replyTo));
  head.push(foldHeader('Subject', encodeWord(subject ?? '')));
  head.push(foldHeader('Message-ID', mid));
  head.push('MIME-Version: 1.0');
  for (const [k, v] of Object.entries(headers)) head.push(foldHeader(k, encodeWord(v)));

  let body;
  if (html && text) {
    const boundary = `fm_alt_${crypto.randomBytes(12).toString('hex')}`;
    head.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      '--' + boundary,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(text),
      '--' + boundary,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(html),
      '--' + boundary + '--',
    ].join('\r\n');
  } else {
    const isHtml = Boolean(html);
    head.push(`Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=UTF-8`);
    head.push('Content-Transfer-Encoding: base64');
    body = wrapBase64(isHtml ? html : (text ?? ''));
  }

  // base64 bodies never contain a bare ".", but dot-stuffing is applied
  // unconditionally so a future quoted-printable body cannot silently truncate.
  return `${head.join('\r\n')}\r\n\r\n${dotStuff(body)}\r\n`;
}

/** base64 with the RFC 2047 76-char line limit. */
export function wrapBase64(input, width = 76) {
  const b64 = Buffer.from(String(input ?? ''), 'utf8').toString('base64');
  return b64.replace(new RegExp(`(.{${width}})`, 'g'), '$1\r\n').replace(/\r\n$/, '');
}

/**
 * Parse an SMTP multiline reply.
 *
 * A reply is complete when the fourth character of the last line is a SPACE;
 * "250-" continuations mean more lines are coming. Reading only the first line
 * is the classic bug: it makes the client act on a partial answer.
 *
 * @param {string} buffer everything read so far
 * @returns {{ complete: boolean, code: number|null, lines: string[], text: string }}
 */
export function parseReply(buffer) {
  const raw = String(buffer || '');
  const lines = raw.split('\r\n').filter((l) => l.length > 0);
  if (!lines.length) return { complete: false, code: null, lines: [], text: '' };
  const last = lines[lines.length - 1];
  const code = Number(last.slice(0, 3));
  // complete only when we have a terminator line ("NNN ") AND the buffer ends
  // with CRLF — otherwise the final line may still be arriving
  const complete = lines.length > 0 && last[3] === ' ' && raw.endsWith('\r\n') && Number.isFinite(code);
  return { complete, code: Number.isFinite(code) ? code : null, lines, text: lines.map((l) => l.slice(4)).join(' ') };
}

/**
 * The command sequence for a session — PURE, so it can be asserted without a
 * server. `auth` is one of 'login' | 'plain' | null.
 *
 * AUTH LOGIN is a two-step base64 exchange; AUTH PLAIN is one step. LOGIN is
 * preferred because a minority of Indian transactional providers advertise both
 * but implement PLAIN incorrectly.
 */
export function smtpCommands({ host, user = null, pass = null, auth = 'login', from, to, message }) {
  const out = [];
  out.push({ expect: 220, send: `EHLO ${host}` });
  if (auth && user) {
    if (auth === 'plain') {
      const token = Buffer.from(`\u0000${user}\u0000${pass ?? ''}`, 'utf8').toString('base64');
      out.push({ expect: 235, send: `AUTH PLAIN ${token}` });
    } else {
      out.push({ expect: 334, send: 'AUTH LOGIN' });
      out.push({ expect: 334, send: Buffer.from(String(user), 'utf8').toString('base64') });
      out.push({ expect: 235, send: Buffer.from(String(pass ?? ''), 'utf8').toString('base64') });
    }
  }
  out.push({ expect: 250, send: `MAIL FROM:<${from}>` });
  for (const r of (Array.isArray(to) ? to : [to])) {
    out.push({ expect: 250, send: `RCPT TO:<${r}>` });
  }
  out.push({ expect: 354, send: 'DATA' });
  out.push({ expect: 250, send: `${message.replace(/\r\n$/, '')}\r\n.` });
  out.push({ expect: 221, send: 'QUIT' });
  return out;
}

/** Extract the bare address from "Name <a@b.c>" — MAIL FROM must be the address alone. */
export function bareAddress(value) {
  const m = String(value || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(value || '')).trim();
}

/** Does the server's EHLO reply advertise STARTTLS? */
export function needsStartTls(ehloText, { secure } = {}) {
  if (secure) return false; // already TLS from the first byte
  return /\bSTARTTLS\b/i.test(String(ehloText || ''));
}

/**
 * Which AUTH mechanisms the server advertised.
 *
 * Must match an EHLO CAPABILITY LINE that begins with AUTH — not any occurrence
 * of the word. A naive `/AUTH[ =](.*)/` matches a greeting like "250 no auth
 * here" and invents a mechanism called "HERE", which then selects the wrong
 * AUTH command and fails the login in a way that looks like bad credentials.
 *
 * Both the RFC 4954 space form (`AUTH LOGIN PLAIN`) and the older `AUTH=LOGIN`
 * form are accepted.
 */
export function advertisedAuth(ehloText) {
  for (const rawLine of String(ehloText || '').split(/\r?\n/)) {
    // strip the reply-code prefix ("250-" / "250 ") before matching, so the
    // capability keyword is at the start of what remains
    const line = rawLine.replace(/^\d{3}[- ]/, '').trim();
    const m = line.match(/^AUTH[ =]([^\r\n]*)$/i);
    if (!m) continue;
    const mechs = m[1].toUpperCase().split(/[\s,]+/).filter(Boolean);
    if (mechs.length) return mechs;
  }
  return [];
}

/**
 * Send one message. The thin half: it moves the bytes the pure layer built.
 *
 * Fails LOUD. A mail transport that swallows errors turns "the customer never
 * got their OTP" into a silent support ticket, so every non-2xx is an exception
 * carrying the server's own words.
 *
 * @param {object} opts
 * @param {string} opts.host
 * @param {number} [opts.port]        465 (implicit TLS) or 587 (STARTTLS)
 * @param {boolean} [opts.secure]     force implicit TLS
 * @param {string} [opts.user]
 * @param {string} [opts.pass]
 * @param {string} opts.from
 * @param {string|string[]} opts.to
 * @param {string} opts.subject
 * @param {string} [opts.text]
 * @param {string} [opts.html]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ ok: true, messageId: string, recipients: string[] }>}
 */
export async function sendMail({
  host, port = 587, secure = port === 465, user = null, pass = null,
  from, to, subject, text = null, html = null, replyTo = null, headers = {},
  timeoutMs = 15000, domain = 'localhost',
}) {
  if (!host) throw new Error('sendMail: SMTP_HOST is required');
  const recipients = (Array.isArray(to) ? to : [to]).map(bareAddress).filter(Boolean);
  if (!recipients.length) throw new Error('sendMail: no recipients');

  const message = buildMimeMessage({
    from, to, subject, text, html, replyTo, headers, domain,
  });
  const sender = bareAddress(from);

  const socket = await openSocket({ host, port, secure, timeoutMs });
  const session = createSession(socket, { timeoutMs });
  try {
    await session.expect(220, 'greeting');

    // EHLO first: its reply tells us whether to upgrade and how to authenticate.
    // The command list is built PROGRESSIVELY rather than precomputed, because
    // the auth mechanism can only be chosen from what the server advertises
    // AFTER any STARTTLS upgrade — precomputing it would guess.
    await session.send(`EHLO ${domain}`);
    let ehlo = await session.expect(250, 'EHLO');

    if (needsStartTls(ehlo.text, { secure })) {
      await session.send('STARTTLS');
      await session.expect(220, 'STARTTLS');
      session.upgradeToTls({ host });
      // A TLS upgrade resets the server's EHLO state: it MUST be repeated, and
      // the AUTH mechanisms re-read from the new (encrypted) reply.
      await session.send(`EHLO ${domain}`);
      ehlo = await session.expect(250, 'EHLO after STARTTLS');
    }

    if (user) {
      const mechs = advertisedAuth(ehlo.text);
      // LOGIN is preferred (a minority of transactional providers advertise both
      // but implement PLAIN incorrectly); PLAIN is the fallback when LOGIN is
      // genuinely not offered.
      if (!mechs.length || mechs.includes('LOGIN')) {
        await session.send('AUTH LOGIN');
        await session.expect(334, 'AUTH LOGIN');
        await session.send(Buffer.from(String(user), 'utf8').toString('base64'));
        await session.expect(334, 'AUTH LOGIN username');
        await session.send(Buffer.from(String(pass ?? ''), 'utf8').toString('base64'));
        await session.expect(235, 'AUTH LOGIN password');
      } else {
        const token = Buffer.from(`\u0000${user}\u0000${pass ?? ''}`, 'utf8').toString('base64');
        await session.send(`AUTH PLAIN ${token}`);
        await session.expect(235, 'AUTH PLAIN');
      }
    }

    await session.send(`MAIL FROM:<${sender}>`);
    await session.expect(250, 'MAIL FROM');
    for (const r of recipients) {
      await session.send(`RCPT TO:<${r}>`);
      await session.expect(250, `RCPT TO ${r}`);
    }
    await session.send('DATA');
    await session.expect(354, 'DATA');
    // the message, then a lone "." on its own line to end the transfer
    await session.send(`${message.replace(/\r\n$/, '')}\r\n.`);
    await session.expect(250, 'end of DATA');
    await session.send('QUIT');
    // 221 is the polite goodbye; a server that hangs up first is not a failure,
    // because the 250 above already means the message was accepted.
    await session.expect(221, 'QUIT').catch(() => {});

    return {
      ok: true,
      messageId: (message.match(/Message-ID: (.*)/) || [, null])[1],
      recipients,
    };
  } finally {
    session.destroy();
  }
}

/** Open a plain or TLS socket. */
function openSocket({ host, port, secure, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const connect = secure ? tls.connect : net.connect;
    const sock = connect({ host, port, servername: secure ? host : undefined }, () => resolve(sock));
    sock.setTimeout(timeoutMs);
    sock.setEncoding('utf8');
    sock.once('error', reject);
    sock.once('timeout', () => reject(new Error(`SMTP timeout after ${timeoutMs}ms connecting to ${host}:${port}`)));
  });
}

/** The read/write loop: buffer until a complete reply, then compare the code. */
function createSession(initialSocket, { timeoutMs }) {
  let socket = initialSocket;
  let buffer = '';
  const waiters = [];

  const onData = (chunk) => {
    buffer += chunk;
    const reply = parseReply(buffer);
    if (reply.complete && waiters.length) {
      const { resolve } = waiters.shift();
      buffer = '';
      resolve(reply);
    }
  };
  const onError = (err) => {
    while (waiters.length) waiters.shift().reject(err);
  };
  socket.on('data', onData);
  socket.once('error', onError);

  return {
    send(line) {
      return new Promise((resolve, reject) => {
        socket.write(`${line}\r\n`, (err) => (err ? reject(err) : resolve()));
      });
    },
    expect(code, label) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`SMTP timeout waiting for ${code} (${label})`)),
          timeoutMs,
        );
        waiters.push({
          resolve: (reply) => {
            clearTimeout(timer);
            if (reply.code !== code) {
              reject(new Error(`SMTP ${label} failed: expected ${code}, got ${reply.code} — ${reply.text}`));
              return;
            }
            resolve(reply);
          },
          reject: (err) => { clearTimeout(timer); reject(err); },
        });
        // the greeting may already be buffered before we started waiting
        const already = parseReply(buffer);
        if (already.complete && waiters.length) {
          const w = waiters.shift();
          buffer = '';
          w.resolve(already);
        }
      });
    },
    /** Upgrade an existing plaintext socket to TLS (STARTTLS). */
    upgradeToTls({ host }) {
      const plain = socket;
      plain.removeListener('data', onData);
      buffer = '';
      socket = tls.connect({ socket: plain, servername: host }, () => {});
      socket.setEncoding('utf8');
      socket.on('data', onData);
      socket.once('error', onError);
    },
    destroy() {
      try { socket.destroy(); } catch { /* already gone */ }
    },
  };
}

export default {
  encodeWord, foldHeader, dotStuff, wrapBase64, buildMimeMessage,
  parseReply, smtpCommands, bareAddress, needsStartTls, advertisedAuth, sendMail,
};
