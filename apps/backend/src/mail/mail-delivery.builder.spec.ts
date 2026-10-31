import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AccountConfig } from '../accounts/entities/account-config.entity';
import { Account } from '../accounts/entities/account.entity';
import { BrandingService } from '../branding/branding.service';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { StorageService } from '../storage/storage.service';
import { Submission } from '../submissions/entities/submission.entity';
import { Submitter } from '../submitters/entities/submitter.entity';
import { Template } from '../templates/entities/template.entity';
import { User } from '../users/entities/user.entity';
import { MailBrandingService } from './mail-branding.service';
import { MailDeliveryBuilder } from './mail-delivery.builder';
import { MailTemplateResolver } from './mail-template-resolver.service';
function setup() {
  const accountConfigs = {
    findOne: jest
      .fn<Promise<Partial<AccountConfig> | null>, [unknown]>()
      .mockResolvedValue(null),
  };
  const storage = {
    findRecordAttachments: jest
      .fn<Promise<StorageAttachment[]>, [unknown]>()
      .mockResolvedValue([]),
    readBlob: jest
      .fn<Promise<Buffer>, [unknown]>()
      .mockResolvedValue(Buffer.from('document')),
  };
  const config = new ConfigService({
    FRONTEND_ORIGIN: 'https://sign.example.test',
    JWT_SECRET: 'test-secret',
  });
  const branding = new MailBrandingService(config, {} as BrandingService);
  const builder = new MailDeliveryBuilder(
    accountConfigs as unknown as Repository<AccountConfig>,
    branding,
    storage as unknown as StorageService,
    new MailTemplateResolver(config),
    config,
  );
  const sender: User = Object.assign(new User(), {
    email: 'owner@example.test',
    firstName: 'Account',
    lastName: 'Owner',
  });
  const template: Template = Object.assign(new Template(), {
    id: 'template',
    name: 'Agreement',
    preferences: {},
    fields: [{ uuid: 'signature', submitter_uuid: 'party', type: 'signature' }],
    archivedAt: null,
  });
  const submission: Submission = Object.assign(new Submission(), {
    id: 'submission',
    templateId: 'template',
    name: 'My Agreement',
    template,
    preferences: {},
    templateFields: null,
    createdByUser: sender,
    expireAt: new Date('2026-12-01'),
    archivedAt: null,
    submitters: [],
  });
  const submitter: Submitter = Object.assign(new Submitter(), {
    id: 'submitter',
    accountId: 'tenant',
    account: Object.assign(new Account(), {
      name: 'Example Org',
      locale: 'fr',
    }),
    submissionId: 'submission',
    submission,
    uuid: 'party',
    slug: 'signing-slug',
    email: 'signer@example.test',
    name: 'Signer Person',
    phone: '+15551234567',
    preferences: {},
    completedAt: null,
    declinedAt: null,
  });
  submission.submitters = [submitter];
  return {
    builder,
    submitter,
    submission,
    template,
    accountConfigs,
    storage,
    sender,
  };
}
function document(
  filename: string,
  bytes: number,
  contentType: string | null = 'application/pdf',
) {
  return Object.assign(new StorageAttachment(), {
    blob: Object.assign(new StorageBlob(), {
      filename,
      byteSize: String(bytes),
      contentType,
    }),
  });
}
it('builds invitations with signed email click tracking, account context and signature-specific instructions', async () => {
  const { builder, submitter, accountConfigs } = setup();
  const result = await builder.buildInvitation(submitter);
  expect(result).toMatchObject({
    accountId: 'tenant',
    locale: 'fr',
    to: { email: 'signer@example.test', name: 'Signer Person' },
    template: 'submitter-invitation',
    replyTo: { email: 'owner@example.test', name: 'Account Owner' },
    context: {
      templateName: 'My Agreement',
      accountName: 'Example Org',
      submitterFirstName: 'Signer',
      senderName: 'Account Owner',
      submissionExpireAt: '2026-12-01T00:00:00.000Z',
      actionLabel: 'Review and Sign',
      headline: 'You are invited to sign a document',
    },
  });
  const link = new URL(String(result?.context?.actionUrl));
  expect(link.origin + link.pathname).toBe(
    'https://sign.example.test/s/signing-slug',
  );
  expect(link.searchParams.get('t')).toMatch(/^[A-Za-z0-9_-]{6}$/);
  expect(result?.context?.contentHtml).toContain('My Agreement');
  expect(accountConfigs.findOne).toHaveBeenCalledWith({
    where: { accountId: 'tenant', key: 'submitter_invitation_email' },
  });
});
it.each([
  'email',
  'completed',
  'declined',
  'archived submission',
  'archived template',
  'disabled mail',
])('suppresses invitation and reminder for %s', async (mode) => {
  const { builder, submitter, template, submission } = setup();
  if (mode === 'email') submitter.email = null;
  if (mode === 'completed') submitter.completedAt = new Date();
  if (mode === 'declined') submitter.declinedAt = new Date();
  if (mode === 'archived submission') submission.archivedAt = new Date();
  if (mode === 'archived template') template.archivedAt = new Date();
  if (mode === 'disabled mail') submitter.preferences.send_email = false;
  expect(await builder.buildInvitation(submitter)).toBeNull();
  expect(await builder.buildInvitationReminder(submitter)).toBeNull();
});
it.each(['account', 'template', 'role', 'message', 'submitter'])(
  'resolves custom invitation copy from %s using documented precedence',
  async (level) => {
    const { builder, submitter, template, accountConfigs } = setup();
    accountConfigs.findOne.mockResolvedValue({
      value: { subject: 'account {template.name}', body: 'account body' },
    });
    if (level !== 'account')
      template.preferences = {
        request_email_subject: 'template {template.name}',
        request_email_body: 'template body',
      };
    if (['role', 'message', 'submitter'].includes(level))
      template.preferences.submitters = [
        null,
        { uuid: 'other', request_email_body: 'other body' },
        {
          uuid: 'party',
          request_email_subject: 'role {template.name}',
          request_email_body: 'role body',
        },
      ];
    if (['message', 'submitter'].includes(level))
      submitter.preferences.message = {
        subject: 'message {template.name}',
        body: 'message body',
      };
    if (level === 'submitter')
      Object.assign(submitter.preferences, {
        request_email_subject: 'submitter {template.name}',
        request_email_body: 'submitter body',
      });
    const result = await builder.buildInvitation(submitter);
    expect(result?.subject).toBe(`${level} My Agreement`);
    expect(result?.context?.contentHtml).toContain(`${level} body`);
  },
);
it('ignores malformed optional invitation preferences and uses form-specific labels with contextual fallbacks', async () => {
  const { builder, submitter, template, submission, accountConfigs } = setup();
  submission.name = null;
  submission.createdByUser = null;
  submission.expireAt = null;
  template.preferences = {
    request_email_body: 1,
    request_email_subject: '  ',
    submitters: [{ uuid: 'missing' }],
  };
  template.fields = [];
  submitter.name = null;
  submitter.account = undefined as unknown as Account;
  submitter.preferences.message = [];
  accountConfigs.findOne.mockResolvedValue({ value: [] });
  const result = await builder.buildInvitation(submitter);
  expect(result?.context).toMatchObject({
    templateName: 'Agreement',
    accountName: 'Signa',
    recipientName: 'there',
    senderName: null,
    senderEmail: null,
    submissionExpireAt: null,
    actionLabel: 'Review and Submit',
    headline: 'You are invited to submit a form',
  });
  expect(result?.replyTo).toBeNull();
  submission.template = null;
  expect(builder.buildVerification(submitter, '123456')?.context).toMatchObject(
    {
      templateName: 'Document',
      otpCode: '123456',
      submitterName: 'signer@example.test',
    },
  );
  submitter.email = null;
  expect(builder.buildVerification(submitter, '123456')).toBeNull();
});
it.each([
  ['help@example.test', 'help@example.test'],
  ['no-reply@example.test', null],
  ['noreply@example.test', null],
])(
  'uses a safe configured reply-to %s and prevents self-replies',
  async (replyTo, expected) => {
    const { builder, submitter, sender } = setup();
    submitter.preferences.reply_to = replyTo;
    sender.email = submitter.email!;
    expect((await builder.buildInvitation(submitter))?.replyTo).toBe(expected);
  },
);
it('uses account reply-to and reminder customizations while retaining non-signature form actions', async () => {
  const { builder, submitter, template, submission, accountConfigs } = setup();
  accountConfigs.findOne.mockResolvedValue({
    value: {
      reply_to: 'support@example.test',
      body: 'Reminder for {submitter.name}',
      subject: 'Reminder: {template.name}',
    },
  });
  submission.templateFields = [
    { type: 'text', submitter_uuid: submitter.uuid },
  ];
  let result = await builder.buildInvitationReminder(submitter);
  expect(result).toMatchObject({
    replyTo: 'support@example.test',
    subject: 'Reminder: My Agreement',
    context: { actionLabel: 'Review and Submit', headline: 'Reminder to sign' },
  });
  expect(result?.context?.contentHtml).toContain('Reminder for Signer Person');
  template.preferences = {
    invitation_reminder_email_body: 'Template reminder',
    invitation_reminder_email_subject: 'Custom reminder',
  };
  result = await builder.buildInvitationReminder(submitter);
  expect(result?.subject).toBe('Custom reminder');
  expect(result?.context?.contentHtml).toContain('Template reminder');
});
it.each(['recipient missing', 'submission disabled', 'template disabled'])(
  'suppresses completed notifications when %s',
  async (mode) => {
    const { builder, submitter, submission, template } = setup();
    if (mode === 'recipient missing') submission.createdByUser = null;
    if (mode === 'submission disabled')
      submission.preferences.send_email = false;
    if (mode === 'template disabled')
      template.preferences.completed_notification_email_enabled = false;
    expect(await builder.buildCompletedNotifications(submitter)).toEqual([]);
  },
);
it('builds completion notices with completed signer names and bounded document/audit attachments', async () => {
  const { builder, submitter, submission, storage, accountConfigs } = setup();
  submitter.completedAt = new Date('2026-01-02');
  submission.submitters = [
    submitter,
    { ...submitter, name: null },
    { ...submitter, name: null, email: null },
    { ...submitter, name: null, email: null, phone: null },
    submitter,
  ];
  accountConfigs.findOne.mockResolvedValue({
    value: {
      body: 'Completed by {submission.submitters}',
      subject: 'Signed {template.name}',
    },
  });
  storage.findRecordAttachments
    .mockResolvedValueOnce([
      document('signed.pdf', 100, null),
      document('too-large.pdf', 11 * 1024 * 1024),
    ])
    .mockResolvedValueOnce([document('audit.pdf', 100)]);
  const [result] = await builder.buildCompletedNotifications(submitter);
  expect(result.subject).toBe('Signed My Agreement');
  expect(result.context?.submissionSubmitters).toBe(
    'Signer Person, signer@example.test, +15551234567',
  );
  expect(result.attachments).toEqual([
    {
      filename: 'signed.pdf',
      content: Buffer.from('document'),
      contentType: undefined,
    },
    {
      filename: 'audit.pdf',
      content: Buffer.from('document'),
      contentType: 'application/pdf',
    },
  ]);
  expect(storage.readBlob).toHaveBeenCalledTimes(2);
});
it('respects attachment opt-outs and an audit file that exceeds the total size budget', async () => {
  const { builder, submitter, template, storage, accountConfigs } = setup();
  template.preferences = {
    completed_notification_email_body: 'Template completed',
    completed_notification_email_subject: 'Template signed',
    completed_notification_email_attach_documents: false,
    completed_notification_email_attach_audit: false,
  };
  expect(
    (await builder.buildCompletedNotifications(submitter))[0],
  ).toMatchObject({ subject: 'Template signed', attachments: [] });
  expect(storage.findRecordAttachments).not.toHaveBeenCalled();
  template.preferences = {};
  accountConfigs.findOne.mockResolvedValue({
    value: { attach_documents: false, attach_audit_log: false },
  });
  expect(
    (await builder.buildCompletedNotifications(submitter))[0].attachments,
  ).toEqual([]);
  accountConfigs.findOne.mockResolvedValue(null);
  storage.findRecordAttachments
    .mockResolvedValueOnce([document('signed.pdf', 10 * 1024 * 1024)])
    .mockResolvedValueOnce([document('audit.pdf', 1)]);
  expect(
    (await builder.buildCompletedNotifications(submitter))[0].attachments,
  ).toHaveLength(1);
});
it('builds document copies in completion order and supports separate recipients for BCC privacy', async () => {
  const { builder, submitter, submission, template, accountConfigs } = setup();
  submitter.completedAt = new Date('2026-01-02');
  const earlier = {
    ...submitter,
    email: 'earlier@example.test',
    completedAt: new Date('2026-01-01'),
  };
  submission.submitters = [
    submitter,
    { ...submitter, email: null },
    {
      ...submitter,
      email: 'disabled@example.test',
      preferences: { send_email: false },
    },
    earlier,
  ];
  template.preferences = {
    documents_copy_email_body: 'Your documents',
    documents_copy_email_subject: 'Ready {template.name}',
    documents_copy_email_attach_documents: false,
    documents_copy_email_attach_audit: false,
  };
  let result = await builder.buildDocumentsCopy(submitter);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    subject: 'Ready My Agreement',
    to: [{ email: 'earlier@example.test' }, { email: 'signer@example.test' }],
    attachments: [],
  });
  accountConfigs.findOne.mockResolvedValue({ value: { bcc_recipients: true } });
  result = await builder.buildDocumentsCopy(submitter);
  expect(result).toHaveLength(2);
  expect(result[0].to).toMatchObject({ email: 'earlier@example.test' });
  expect(result[1].to).toMatchObject({ email: 'signer@example.test' });
});
it('handles disabled, empty and default document-copy recipient/config paths', async () => {
  const { builder, submitter, submission, accountConfigs } = setup();
  accountConfigs.findOne.mockResolvedValue({ value: { enabled: false } });
  expect(await builder.buildDocumentsCopy(submitter)).toEqual([]);
  accountConfigs.findOne.mockResolvedValue(null);
  submission.submitters = [];
  expect(await builder.buildDocumentsCopy(submitter)).toEqual([]);
  submission.submitters = [submitter];
  expect((await builder.buildDocumentsCopy(submitter))[0].template).toBe(
    'submitter-documents-copy',
  );
});
it('builds declined notices with phone/name fallbacks and suppresses notices without an owner', () => {
  const { builder, submitter, submission } = setup();
  submitter.name = null;
  submitter.email = null;
  expect(builder.buildDeclined(submitter, 'Please revise')[0]).toMatchObject({
    subject: 'My Agreement has been declined by +15551234567',
    context: { declineReason: 'Please revise', submitterFirstName: null },
  });
  submitter.phone = null;
  expect(builder.buildDeclined(submitter)[0].subject).toContain('by submitter');
  submission.createdByUser = null;
  expect(builder.buildDeclined(submitter)).toEqual([]);
});
it('builds safe default invitations and reminders for a submission without its original template', async () => {
  const { builder, submitter, submission } = setup();
  submission.template = null;
  submitter.name = null;
  const invitation = await builder.buildInvitation(submitter);
  const reminder = await builder.buildInvitationReminder(submitter);
  expect(invitation?.context).toMatchObject({
    actionLabel: 'Review and Submit',
    recipientName: 'there',
  });
  expect(reminder?.context).toMatchObject({
    actionLabel: 'Review and Submit',
    recipientName: 'there',
    headline: 'Reminder to sign',
  });
  expect(invitation?.subject).toBeTruthy();
  expect(reminder?.subject).toBeTruthy();
  expect(reminder?.context?.contentHtml).toBeTruthy();
  expect(
    (await builder.buildCompletedNotifications(submitter))[0].subject,
  ).toBeTruthy();
  expect((await builder.buildDocumentsCopy(submitter))[0].subject).toBeTruthy();
});
it('uses the signing action for reminders when the submission snapshot contains a signature field', async () => {
  const { builder, submitter } = setup();
  expect(
    (await builder.buildInvitationReminder(submitter))?.context?.actionLabel,
  ).toBe('Review and Sign');
});
it('attaches an audit trail with unspecified MIME type without inventing a content type', async () => {
  const { builder, submitter, storage } = setup();
  storage.findRecordAttachments
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([document('audit.pdf', 100, null)]);
  expect(
    (await builder.buildCompletedNotifications(submitter))[0].attachments,
  ).toEqual([
    {
      filename: 'audit.pdf',
      content: Buffer.from('document'),
      contentType: undefined,
    },
  ]);
});
