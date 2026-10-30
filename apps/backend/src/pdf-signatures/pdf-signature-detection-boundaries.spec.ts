import {
  detectPdfSignatures,
  extractPdfHexBuffer,
  extractPdfObjectContaining,
  materializePdfSignedBytes,
} from './pdf-signature-detection';
function dictionary(entries: string) {
  return Buffer.from(
    `%PDF-1.7\n1 0 obj\n<< /Type /Sig /ByteRange [0 0 0 0] ${entries} >>\nendobj\n%%EOF`,
    'latin1',
  );
}
it('extracts escaped signer names and complete text metadata without treating escaped parentheses as terminators', () => {
  const [result] = detectPdfSignatures(
    dictionary(
      String.raw`/Name (Casey \(Example\) \\ Team) /Reason (line\nnext\r\ttab\b\f) /M (20261031T120000Z)`,
    ),
  );
  expect(result.signerName).toBe('Casey (Example) \\ Team');
  expect(result.signingReason).toBe('line\nnext\r\ttab\b\f');
  expect(result.signingTime).toBe('20261031T120000Z');
});
it('reads UTF-8 hex metadata and tolerates empty hex signature padding', () => {
  expect(
    detectPdfSignatures(dictionary('/Name <4361736579> /Contents <   >'))[0],
  ).toMatchObject({ signerName: 'Casey', contents: null });
  expect(extractPdfHexBuffer('/Contents missing', 'Contents')).toBeNull();
});
it('returns no signer name for a truncated literal string', () => {
  expect(
    detectPdfSignatures(dictionary('/Name (unterminated'))[0].signerName,
  ).toBeNull();
});
it.each([
  '0 0 0',
  '9007199254740993 0 0 0',
  '1 0 0 0',
  '0 10 1 0',
  '0 0 0 999999',
  'invalid',
])('marks malformed or out-of-bounds ByteRange %s invalid', (range) => {
  const source = dictionary('').toString().replace('[0 0 0 0]', `[${range}]`);
  expect(detectPdfSignatures(Buffer.from(source))[0].byteRange).toMatchObject({
    valid: false,
    ranges: null,
    sha256: null,
  });
});
it('materializes only the two signed spans and returns null when no valid spans exist', () => {
  const pdf = Buffer.from('0123456789');
  expect(materializePdfSignedBytes(pdf, [0, 2, 7, 3])).toEqual(
    Buffer.from('01789'),
  );
  expect(materializePdfSignedBytes(pdf, null)).toBeNull();
});
it('bounds dictionary extraction when damaged PDFs omit object wrappers and end markers', () => {
  const text = 'prefix << /ByteRange [0 0 0 0] /Name (Casey) >>';
  expect(extractPdfObjectContaining(text, text.indexOf('/ByteRange'))).toBe(
    '<< /ByteRange [0 0 0 0] /Name (Casey) >>',
  );
});
it('decodes PDF Unicode text strings using their UTF-16 big-endian BOM', () => {
  expect(
    detectPdfSignatures(
      dictionary('/Name <FEFF00430061007300650079002003A9>'),
    )[0].signerName,
  ).toBe('Casey Ω');
});

it('replaces an incomplete Unicode code unit without throwing on malformed metadata', () => {
  expect(
    detectPdfSignatures(dictionary('/Name <FEFF004300>'))[0].signerName,
  ).toBe('C\uFFFD');
});
it.each(['0 -5 10 0', '0 0 0 -1'])(
  'rejects negative byte-range lengths rather than silently changing their sign (%s)',
  (range) => {
    const source = dictionary('').toString().replace('[0 0 0 0]', `[${range}]`);
    expect(detectPdfSignatures(Buffer.from(source))[0].byteRange).toMatchObject(
      { valid: false, ranges: null },
    );
  },
);
