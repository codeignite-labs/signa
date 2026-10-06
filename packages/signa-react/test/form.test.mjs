import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function mount(dataset = { src: 'https://sign.example/s/document' }) {
  let ElementClass;
  const messages = [];
  const events = [];
  let navigations = 0;
  const frame = {
    style: {}, setAttribute() {},
    contentWindow: { postMessage: (...args) => messages.push(args) },
    get src() { return this.url; },
    set src(value) { this.url = value; navigations++; },
  };
  const context = {
    URL,
    HTMLElement: class { dataset = dataset; isConnected = true; appendChild() {} dispatchEvent(event) { events.push(event); } },
    CustomEvent: class { constructor(type, options) { Object.assign(this, { type }, options); } },
    document: { createElement: () => frame },
    window: {
      location: { href: 'https://host.example/' },
      addEventListener() {}, removeEventListener() {},
      customElements: { get() {}, define: (_, element) => { ElementClass = element; } },
    },
  };
  vm.runInNewContext(readFileSync(new URL('../browser/form.js', import.meta.url), 'utf8'), context);
  const element = new ElementClass();
  element.connectedCallback();
  return { element, frame, messages, events, navigations: () => navigations };
}

test('keeps organization branding as the default', () => {
  const { frame } = mount();
  const url = new URL(frame.src);
  assert.equal(url.searchParams.get('embed'), 'true');
  assert.equal(url.searchParams.has('primary-color'), false);
  assert.equal(url.searchParams.has('theme'), false);
});

test('updates host appearance without reloading the signing document', () => {
  const result = mount();
  result.element.dataset.theme = 'dark';
  result.element.dataset.primaryColor = '#7c3aed';
  result.element.attributeChangedCallback('data-theme');
  assert.equal(result.navigations(), 1);
  assert.equal(result.messages[0][0].appearance.primaryColor, '#7c3aed');
  assert.equal(result.messages[0][1], 'https://sign.example');
  result.element.handleMessage({ source: result.frame.contentWindow, origin: 'https://sign.example', data: { source: 'signa', type: 'appearance-ready' } });
  assert.equal(result.messages.length, 2);
});

test('ignores events from other frames and invalid resize payloads', () => {
  const { element, frame, events } = mount();
  element.handleMessage({ source: {}, origin: 'https://sign.example', data: { source: 'signa', type: 'completed' } });
  element.handleMessage({ source: frame.contentWindow, origin: 'https://evil.example', data: { source: 'signa', type: 'completed' } });
  assert.equal(events.length, 0);
  element.handleMessage({ source: frame.contentWindow, origin: 'https://sign.example', data: { source: 'signa', type: 'resize', height: 'not-a-number' } });
  assert.equal(frame.style.height, undefined);
});

test('rejects executable signing URLs', () => {
  assert.throws(() => mount({ src: 'javascript:alert(1)' }), /HTTP/);
});

test('the hosted browser bridge matches the package', () => {
  assert.equal(readFileSync(new URL('../browser/form.js', import.meta.url), 'utf8'), readFileSync(new URL('../../../apps/frontend/public/js/form.js', import.meta.url), 'utf8'));
});
