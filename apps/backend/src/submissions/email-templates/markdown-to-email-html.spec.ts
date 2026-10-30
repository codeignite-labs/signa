import { markdownToEmailHtml } from './markdown-to-email-html';
it('renders supported inline formatting with HTML escaping', () => {
  expect(
    markdownToEmailHtml('++under++ **bold** *italic* `code<script>`'),
  ).toBe(
    '<p><u>under</u> <strong>bold</strong> <em>italic</em> code&lt;script&gt;</p>',
  );
  expect(markdownToEmailHtml('<img src=x> & "quoted" \'text\'')).toBe(
    '<p>&lt;img src=x&gt; &amp; &quot;quoted&quot; &#39;text&#39;</p>',
  );
});
it.each(['&nbsp;', '&amp;nbsp;'])(
  'preserves a blank spacer paragraph %s',
  (spacer) => {
    expect(markdownToEmailHtml(spacer)).toBe('<p><br></p>');
  },
);
it.each(['', ' \n\t '])('omits blank email bodies %j', (value) => {
  expect(markdownToEmailHtml(value)).toBe('');
});
it('separates paragraphs, trims empty paragraphs and preserves line breaks', () => {
  expect(markdownToEmailHtml('  First\nline\n\n\nSecond  ')).toBe(
    '<p>First<br>line</p><p>Second</p>',
  );
});
it.each([
  'javascript:alert',
  'data:text/html,<script>',
  'file:///etc/passwd',
  '/relative',
])('rejects unsafe email link target %s', (target) => {
  expect(markdownToEmailHtml(`[Open](${target})`)).toBe('<p>Open</p>');
});
it('accepts HTTP, HTTPS and mailto links and escapes attribute characters', () => {
  expect(
    markdownToEmailHtml(
      '[Mail](mailto:support@example.test) [Doc](https://example.test/?a=1&b=2)',
    ),
  ).toBe(
    '<p><a href="mailto:support@example.test">Mail</a> <a href="https://example.test/?a=1&amp;b=2">Doc</a></p>',
  );
});
it('links bare URLs and www domains without rewriting existing Markdown targets', () => {
  expect(
    markdownToEmailHtml('See http://example.test and www.example.test'),
  ).toBe(
    '<p>See <a href="http://example.test">http://example.test</a> and <a href="https://www.example.test">www.example.test</a></p>',
  );
  expect(markdownToEmailHtml('[Doc](https://example.test)')).toBe(
    '<p><a href="https://example.test">Doc</a></p>',
  );
});
