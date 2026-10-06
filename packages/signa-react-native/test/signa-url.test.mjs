import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSignaSigningUrl } from '../src/signa-url.ts';
import { dispatchSignaMessage } from '../src/signa-message.ts';

test('preserves organization defaults and existing signing parameters', () => {
  const url = new URL(buildSignaSigningUrl({ src: 'https://sign.example/s/id?t=tracking', preview: false }));
  assert.equal(url.searchParams.get('embed'), 'true');
  assert.equal(url.searchParams.get('t'), 'tracking');
  assert.equal(url.searchParams.get('preview'), 'false');
  assert.equal(url.searchParams.has('theme'), false);
});
test('encodes a valid host appearance override', () => {
  const url = new URL(buildSignaSigningUrl({ host: 'https://sign.example/', slug: 'id', theme: 'dark', primaryColor: '#7c3aed' }));
  assert.equal(url.pathname, '/s/id');
  assert.equal(url.searchParams.get('theme'), 'dark');
  assert.equal(url.searchParams.get('primary-color'), '#7c3aed');
});
test('rejects non-web URLs and ignores malformed colors', () => {
  assert.throws(() => buildSignaSigningUrl({ src: 'javascript:alert(1)' }), /HTTPS or HTTP/);
  const url = new URL(buildSignaSigningUrl({ host: 'https://sign.example', slug: 'id', primaryColor: 'red; display:none' }));
  assert.equal(url.searchParams.has('primary-color'), false);
});
test('dispatches completion once and ignores unrelated/malformed messages', () => {
  const completions = [];
  const handlers = { onComplete: (payload) => completions.push(payload) };
  for (const message of ['not json', 'null', '{"type":"other"}']) dispatchSignaMessage(message, handlers);
  dispatchSignaMessage(JSON.stringify({ type: 'signa:completed', payload: { submission_id: '42', submitter: { id: '5', completed_at: '2026-10-06' } } }), handlers);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].submission_id, '42');
});
