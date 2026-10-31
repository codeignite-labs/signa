import { createTemplatesServiceFixture } from '../../test/support/templates-service.fixture';
import { UpdateTemplateDto } from './dto/update-template.dto';
it.each([
  [
    { preferences: { signing_order: 'random' } },
    'Template preferences updated',
  ],
  [{ shared_link: false }, 'Template sharing updated'],
  [{ folder_name: 'Another folder' }, 'Template moved to another folder'],
  [{ external_id: 'crm-external' }, 'Template updated'],
  [{ schema: [{ name: 'New document title' }] }, 'Template documents updated'],
] as Array<[UpdateTemplateDto, string]>)(
  'records an accurate activity summary for %j',
  async (input, summary) => {
    const { service, user, template, templateEvents } =
      await createTemplatesServiceFixture();
    await service.updateTemplate(user, template.id, input);
    expect(templateEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        summary,
      }),
    );
  },
);
it('preserves fields when replacing or removing legacy schema entries without attachment identifiers', async () => {
  const { service, user, template } = await createTemplatesServiceFixture();
  const fields = structuredClone(template.fields);
  template.schema = [{ name: 'Legacy' }];
  await service.updateTemplateDocuments(user, template.id, {
    documents: [{ position: 0, type: 'blank', replace: true }],
  });
  expect(template.fields).toEqual(fields);
  template.schema = [{ name: 'Legacy' }];
  await service.updateTemplateDocuments(user, template.id, {
    documents: [{ position: 0, remove: true }],
  });
  expect(template.fields).toEqual(fields);
});
it('imports newly detected Google Drive fields and preserves fallback MIME metadata', async () => {
  const { service, user, template, pdfBuffer, acro } =
    await createTemplatesServiceFixture();
  template.submitters = [];
  const fetch = jest
    .spyOn(global, 'fetch')
    .mockResolvedValueOnce(
      Response.json({ name: 'Agreement.pdf', mimeType: 'application/pdf' }),
    )
    .mockResolvedValueOnce(
      new Response(pdfBuffer, { headers: { 'content-type': '' } }),
    );
  acro.extractFields.mockResolvedValue([
    {
      name: 'Legal name',
      type: 'text',
      areas: [{ page: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.05 }],
    },
  ]);
  try {
    const result = await service.importGoogleDriveDocuments(user, template.id, {
      access_token: 'synthetic-token',
      files: [{ id: 'google-doc' }],
    });
    expect(result.fields).toHaveLength(2);
    expect(result.submitters).toMatchObject([{ name: 'First Party' }]);
  } finally {
    fetch.mockRestore();
  }
});
it.each([null, 'absent-production'])(
  'returns generic not-found when a testing account has no accessible production template (%s)',
  async (productionAccountId) => {
    const { service, user, accounts, templates } =
      await createTemplatesServiceFixture();
    templates.findOne.mockResolvedValue(null);
    accounts.getTestingAccountContext.mockResolvedValue({
      isTestMode: true,
      productionAccountId,
      testingAccountId: 'tenant',
    });
    await expect(service.getTemplate(user, 'missing')).rejects.toMatchObject({
      status: 404,
      response: { error: 'Template not found' },
    });
  },
);
