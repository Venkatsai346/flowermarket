import test from 'node:test';
import assert from 'node:assert/strict';
import { filenameFromHeaders, sanitizeFilename } from './download.js';

test('parses RFC 5987 content-disposition filenames', () => {
  const headers = { 'content-disposition': "attachment; filename*=UTF-8''invoices%20%282026%29.csv" };
  assert.equal(filenameFromHeaders(headers, 'fallback.csv'), 'invoices (2026).csv');
});

test('prefers the RFC 5987 form over the plain form', () => {
  const headers = { 'content-disposition': 'attachment; filename="old.csv"; filename*=UTF-8\'\'new.csv' };
  assert.equal(filenameFromHeaders(headers), 'new.csv');
});

test('falls back to quoted and plain filename forms', () => {
  assert.equal(filenameFromHeaders({ 'content-disposition': 'attachment; filename="quoted.csv"' }), 'quoted.csv');
  assert.equal(filenameFromHeaders({ 'content-disposition': 'attachment; filename=plain.csv' }), 'plain.csv');
  assert.equal(filenameFromHeaders({}), 'download');
});

test('sanitizes directory traversal and control characters', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('a\x00b\x1fc.csv'), 'abc.csv');
  assert.equal(sanitizeFilename('   '), 'download');
});
