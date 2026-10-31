import {
  PDFAcroSignature,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFSignature,
  PDFString,
  TextAlignment,
} from 'pdf-lib';
import { PdfAcroFormService } from './pdf-acro-form.service';
const service = new PdfAcroFormService();
const area = { x: 20, y: 100, width: 120, height: 20, borderWidth: 0 };
async function extract(document: PDFDocument) {
  return service.extractFields(
    Buffer.from(await document.save({ updateFieldAppearances: false })),
    'attachment',
  );
}
it('extracts empty dropdown/list/radio options, omits localized placeholders, and reconciles widget option counts', async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 200]);
  const form = document.getForm();
  const dropdown = form.createDropdown('Country');
  dropdown.addOptions(['Choose a country', 'Kenya', 'Wählen', 'France']);
  dropdown.addToPage(page, area);
  const list = form.createOptionList('Interests');
  list.addOptions(['Music', 'Art']);
  list.addToPage(page, { ...area, y: 70 });
  const radio = form.createRadioGroup('Answer');
  radio.addOptionToPage('Yes', page, { ...area, y: 40, width: 15, height: 15 });
  radio.addOptionToPage('No', page, {
    ...area,
    x: 60,
    y: 40,
    width: 15,
    height: 15,
  });
  const fields = await extract(document);
  expect(fields.find((field) => field.name === 'Country')).toMatchObject({
    type: 'select',
    options: [{ value: 'Kenya' }, { value: 'France' }],
  });
  const multiple = fields.find((field) => field.name === 'Interests');
  expect(multiple).toMatchObject({
    type: 'multiple',
    options: [{ value: '' }],
  });
  const multipleOptions = multiple?.options as { uuid: string }[] | undefined;
  expect(multiple?.areas?.[0].option_uuid).toBe(multipleOptions?.[0].uuid);
  const answer = fields.find((field) => field.name === 'Answer');
  expect(answer).toMatchObject({
    type: 'radio',
    options: [{ value: 'Yes' }, { value: 'No' }],
  });
  const answerOptions = answer?.options as { uuid: string }[] | undefined;
  expect(answer?.areas?.map((widget) => widget.option_uuid)).toEqual(
    answerOptions?.map((option) => option.uuid),
  );
});
it('skips selected options, checked boxes, prefilled text, unsupported buttons and fields with no widgets', async () => {
  const document = await PDFDocument.create();
  const page = document.addPage();
  const form = document.getForm();
  const dropdown = form.createDropdown('Country');
  dropdown.addOptions(['Kenya']);
  dropdown.select('Kenya');
  dropdown.addToPage(page, area);
  const list = form.createOptionList('Interests');
  list.addOptions(['Art']);
  list.select('Art');
  list.addToPage(page, area);
  const radio = form.createRadioGroup('Answer');
  radio.addOptionToPage('Yes', page, area);
  radio.select('Yes');
  const check = form.createCheckBox('Accepted');
  check.addToPage(page, area);
  check.check();
  const text = form.createTextField('Prefilled');
  text.addToPage(page, area);
  text.setText('Existing');
  const button = form.createButton('Button');
  button.addToPage('Click', page, area);
  form.createTextField('Unplaced');
  expect(await extract(document)).toEqual([]);
});
it('retains tooltip descriptions, date actions, right alignment, max length and normalized names', async () => {
  const document = await PDFDocument.create();
  const page = document.addPage();
  const form = document.getForm();
  const date = form.createTextField('Birth Date');
  date.addToPage(page, area);
  date.setAlignment(TextAlignment.Right);
  date.setMaxLength(10);
  date.enableReadOnly();
  date.acroField.dict.set(
    PDFName.of('TU'),
    PDFHexString.fromText('Use your birth date'),
  );
  date.acroField.dict.set(
    PDFName.of('AA'),
    document.context.obj({
      F: { S: 'JavaScript', JS: PDFString.of('AFDate_FormatEx("mm/dd/yyyy")') },
    }),
  );
  const invalid = form.createTextField('email_address');
  invalid.addToPage(page, { ...area, y: 70 });
  invalid.acroField.dict.set(PDFName.of('TU'), PDFString.of('email_address'));
  const fields = await extract(document);
  expect(fields.find((field) => field.name === 'Birth Date')).toMatchObject({
    type: 'date',
    description: 'Use your birth date',
    readonly: true,
    preferences: { align: 'right', max_length: 10 },
  });
  expect(fields.find((field) => field.name === '')).toMatchObject({
    type: 'text',
  });
  expect(fields.find((field) => field.name === '')).not.toHaveProperty(
    'description',
  );
});
it('finds multiple widgets through page annotations when explicit page references are omitted', async () => {
  const document = await PDFDocument.create();
  document.addPage([300, 200]);
  const second = document.addPage([300, 200]);
  const third = document.addPage([300, 200]);
  const field = document.getForm().createTextField('Repeated Field');
  field.addToPage(second, area);
  field.addToPage(third, area);
  for (const widget of field.acroField.getWidgets())
    widget.dict.delete(PDFName.of('P'));
  const fields = await extract(document);
  expect(fields[0].areas?.map((widget) => widget.page)).toEqual([1, 2]);
});
it('extracts signature/initial fields and skips zero-size or unresolvable widgets', async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 200]);
  const form = document.getForm();
  for (const name of ['Signature', 'Initial Here']) {
    const dictionary = document.context.obj({
      FT: 'Sig',
      T: PDFString.of(name),
    });
    const ref = document.context.register(dictionary);
    const acro = PDFAcroSignature.fromDict(dictionary, ref);
    // Signatures can use the standard combined field/widget dictionary.
    acro.dict.set(PDFName.of('Type'), PDFName.of('Annot'));
    acro.dict.set(PDFName.of('Subtype'), PDFName.of('Widget'));
    acro.dict.set(PDFName.of('Rect'), document.context.obj([20, 20, 120, 40]));
    form.acroForm.addField(acro.ref);
    page.node.addAnnot(acro.ref);
    expect(PDFSignature.of(acro, acro.ref, document)).toBeInstanceOf(
      PDFSignature,
    );
  }
  const zero = form.createTextField('Zero');
  zero.addToPage(page, area);
  zero.acroField
    .getWidgets()[0]
    .setRectangle({ x: 0, y: 0, width: 0, height: 20 });
  const missing = form.createTextField('No Page');
  missing.addToPage(page, area);
  const widget = missing.acroField.getWidgets()[0];
  widget.dict.delete(PDFName.of('P'));
  widget.dict.delete(PDFName.of('Parent'));
  const fields = await extract(document);
  expect(fields.map((field) => field.type)).toEqual(['signature', 'initials']);
});
it('returns no fields for malformed PDFs without exposing parsing failures', async () => {
  expect(
    await service.extractFields(Buffer.from('not a PDF'), 'attachment'),
  ).toEqual([]);
});
