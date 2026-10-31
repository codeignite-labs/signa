import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { DocxVariableService } from './docx-variable.service';
function document(xml: string) {
  return Buffer.from(
    zipSync({
      'word/document.xml': strToU8(xml),
      'word/header1.xml': strToU8('<header>[[name]]</header>'),
      'docProps/core.xml': strToU8('<title>[[name]]</title>'),
      'word/media/image.png': new Uint8Array([1, 2, 3]),
    }),
  );
}
it('replaces nested variables only in Word XML entries while preserving unrelated archive content', () => {
  const source = document(
    '<p>[[customer.name]] [[ name ]] [[missing]] [[customer.missing]]</p>',
  );
  const result = new DocxVariableService().expandVariables(source, {
    customer: { name: 'Customer' },
    name: 'Organization',
  });
  const files = unzipSync(result);
  expect(strFromU8(files['word/document.xml'])).toBe(
    '<p>Customer Organization [[missing]] [[customer.missing]]</p>',
  );
  expect(strFromU8(files['word/header1.xml'])).toBe(
    '<header>Organization</header>',
  );
  expect(strFromU8(files['docProps/core.xml'])).toBe('<title>[[name]]</title>');
  expect(files['word/media/image.png']).toEqual(new Uint8Array([1, 2, 3]));
});
it.each([
  [
    'A & B < C > D "quoted" \'apostrophe\'',
    'A &amp; B &lt; C &gt; D &quot;quoted&quot; &apos;apostrophe&apos;',
  ],
  [42, '42'],
  [false, 'false'],
  [BigInt(42), '42'],
  [null, ''],
  [new Date('2026-01-01'), '2026-01-01T00:00:00.000Z'],
  [{ nested: 'value' }, '{&quot;nested&quot;:&quot;value&quot;}'],
  [['one', 'two'], '[&quot;one&quot;,&quot;two&quot;]'],
])(
  'serializes and XML-escapes supported variable value %s',
  (name, expected) => {
    const result = new DocxVariableService().expandVariables(
      document('<p>[[name]]</p>'),
      { name },
    );
    expect(strFromU8(unzipSync(result)['word/document.xml'])).toBe(
      `<p>${expected}</p>`,
    );
  },
);
it('preserves unresolved paths and returns original bytes when no XML replacement occurred', () => {
  const source = document('<p>[[customer.name]] [[array.0]]</p>');
  const service = new DocxVariableService();
  expect(service.expandVariables(source, undefined)).toBe(source);
  expect(service.expandVariables(source, {})).toBe(source);
  expect(
    service.expandVariables(source, { customer: null, array: ['one'] }),
  ).toBe(source);
});
