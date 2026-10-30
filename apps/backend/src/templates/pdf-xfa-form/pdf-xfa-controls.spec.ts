import {
  PdfjsProcessingService,
  PdfjsXfaNode,
  PdfjsXfaPage,
} from '../../pdf-processing/pdfjs-processing.service';
import { PdfXfaFormService } from './pdf-xfa-form.service';
function control(
  attributes: Record<string, unknown> = {},
  name = 'input',
): PdfjsXfaNode {
  return {
    name,
    attributes: {
      name: 'FullName1',
      style: { width: 200, height: 30, left: 10, top: 20 },
      ...attributes,
    },
  };
}
async function extract(
  nodes: PdfjsXfaNode[],
  pageOptions: Partial<PdfjsXfaPage> = {},
) {
  const pages: PdfjsXfaPage[] = [
    {
      page: 2,
      width: 1000,
      height: 800,
      root: { name: 'div', children: [null, 'text', {}, ...nodes] },
      ...pageOptions,
    },
  ];
  const renderer = { extractXfaPages: jest.fn().mockResolvedValue(pages) };
  return new PdfXfaFormService(
    renderer as unknown as PdfjsProcessingService,
  ).extractFields(Buffer.from('renderer boundary'), 'attachment');
}
it.each(['button', 'hidden', 'reset', 'submit'])(
  'omits HTML %s controls from signing fields',
  async (type) => {
    expect(await extract([control({ type })])).toEqual([]);
  },
);
it.each([
  { value: 'prefilled' },
  { value: ['selected'] },
  { value: true },
  { checked: true },
  { textContent: 'default text' },
])(
  'does not replace existing XFA values with new signer fields (%j)',
  async (attributes) => {
    expect(await extract([control(attributes)])).toEqual([]);
  },
);
it('extracts editable unchecked/empty controls and readable identifier aliases', async () => {
  const fields = await extract([
    control({ name: 'currentDate2', value: '' }),
    control({ name: 'mobilePhone', checked: false }),
    control({ name: 'optIn', type: 'checkbox', checked: false }),
    control({ name: '', dataId: 'Full_Name2', value: [] }),
    control({ name: '', fieldId: 'Company-Name3' }),
    control({ name: 123 }),
  ]);
  expect(fields.map((field) => [field.name, field.type])).toEqual([
    ['current Date', 'date'],
    ['mobile Phone', 'phone'],
    ['opt In', 'checkbox'],
    ['Full Name', 'text'],
    ['Company Name', 'text'],
    ['Text Field', 'text'],
  ]);
  expect(fields[0].areas).toEqual([
    {
      attachment_uuid: 'attachment',
      page: 2,
      x: 0.01,
      y: 0.025,
      w: 0.2,
      h: 0.0375,
    },
  ]);
});
it('generates option lists and select fallbacks from XFA HTML options', async () => {
  const select = control({ multiple: true }, 'select');
  select.children = [{ name: 'option', value: ' First choice ' }];
  const single = control({ name: 'Country' }, 'select');
  const multiline = control(
    {
      name: 'Notes',
      style: { width: '50%', height: '20%' },
      readonly: 'true',
      'aria-required': true,
    },
    'textarea',
  );
  const fields = await extract([select, single, multiline]);
  expect(fields[0]).toMatchObject({
    type: 'multiple',
    options: [{ value: 'First choice' }],
  });
  expect(fields[1]).toMatchObject({
    type: 'select',
    options: [{ value: 'Option 1' }],
  });
  expect(fields[2]).toMatchObject({
    type: 'text',
    readonly: true,
    required: true,
    preferences: { multiline: true },
    areas: [{ w: 0.5, h: 0.2 }],
  });
});
function captionedControl(position: 'xfaLeft' | 'xfaTop'): PdfjsXfaNode {
  return {
    name: 'div',
    attributes: {
      class: 'xfaField',
      xfaName: 'originalName',
      style: { left: 10, top: 20, width: 300, height: 100 },
    },
    children: [
      {
        name: 'label',
        attributes: { class: ['xfaLabel', position, 2] },
        children: [
          {
            name: 'span',
            attributes: {
              class: 'xfaCaption',
              style: { width: 100, height: 20 },
              textContent: 'Customer   Name :',
            },
            children: ['invalid', { name: 'span', value: 'Legal' }],
          },
          control({
            name: 'differentName',
            style: { width: 300, height: 100 },
          }),
        ],
      },
    ],
  };
}
it.each([
  ['xfaLeft', 0.11, 0.025, 0.2, 0.125],
  ['xfaTop', 0.01, 0.05, 0.3, 0.1],
] as const)(
  'subtracts %s captions from field hit areas and prefers human captions',
  async (position, x, y, w, h) => {
    const [field] = await extract([captionedControl(position)]);
    expect(field.name).toBe('Customer Name: Legal');
    expect(field.areas?.[0]).toMatchObject({ x, y, w, h });
  },
);
it('uses wrapper geometry and xfaName when a caption is missing', async () => {
  const [field] = await extract([
    {
      name: 'div',
      attributes: { class: 'xfaField', xfaName: 'LegalReviewer' },
      children: [
        {
          name: 'div',
          attributes: {
            class: 'xfaWrapper',
            style: { width: '250px', height: '40px', left: -10 },
          },
          children: [control({ name: '' })],
        },
      ],
    },
  ]);
  expect(field.name).toBe('Legal Reviewer');
  expect(field.areas?.[0]).toMatchObject({ x: 0, w: 0.25, h: 0.05 });
});
it('groups radio widgets and preserves per-option rectangles, captions and group flags', async () => {
  const radio = (
    caption: string,
    extra: Record<string, unknown> = {},
  ): PdfjsXfaNode => ({
    name: 'label',
    attributes: { class: 'xfaLabel' },
    children: [
      { name: 'span', attributes: { class: 'xfaCaption' }, value: caption },
      control({
        name: 'choice',
        type: 'radio',
        style: { width: 15, height: 15 },
        ...extra,
      }),
    ],
  });
  const [field] = await extract([
    radio('Yes', { required: true }),
    radio('', { readOnly: 'true' }),
  ]);
  expect(field).toMatchObject({
    type: 'radio',
    required: true,
    readonly: true,
    options: [{ value: 'Yes' }, { value: 'Option 2' }],
  });
  const options = field.options as Array<{ uuid: string }>;
  expect(field.areas?.map((area) => area.option_uuid)).toEqual(
    options.map((option) => option.uuid),
  );
  expect(field.areas?.[0]).toMatchObject({ w: 0.015, h: 0.01875 });
});
it.each([{ width: 0 }, { height: 0 }])(
  'omits controls when page dimensions are unusable (%j)',
  async (page) => {
    expect(await extract([control()], page)).toEqual([]);
  },
);
it.each([
  { width: 1, height: 30 },
  { width: 20, height: 0 },
])('omits zero/tiny control hit areas (%j)', async (style) => {
  expect(await extract([control({ style })])).toEqual([]);
});
it('falls back for absent/non-finite CSS values and clamps oversized areas', async () => {
  const fields = await extract([
    control({
      style: {
        width: Number.NaN,
        height: Infinity,
        left: 'invalid%',
        top: 'invalid',
      },
    }),
    control({ style: { width: '200%', height: 'invalid%', top: '200%' } }),
  ]);
  expect(fields[0].areas?.[0]).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
  expect(fields[1].areas?.[0]).toMatchObject({ x: 0, y: 1, w: 1, h: 1 });
});

it('positions nested percentage offsets relative to the parent while preserving zero offset defaults', async () => {
  const [field] = await extract([
    {
      name: 'div',
      attributes: { style: { width: 500, height: 400, left: 10, top: 20 } },
      children: [
        control({ style: { left: '50%', top: '25%', width: 200, height: 30 } }),
      ],
    },
  ]);
  expect(field.areas?.[0]).toMatchObject({
    x: 0.26,
    y: 0.15,
    w: 0.2,
    h: 0.0375,
  });
});
