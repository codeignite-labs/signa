import { EntityManager, Repository } from 'typeorm';
import { AccountConfig } from '../accounts/entities/account-config.entity';
import { StorageAttachment } from '../storage/entities/storage-attachment.entity';
import { StorageBlob } from '../storage/entities/storage-blob.entity';
import { StorageService } from '../storage/storage.service';
import { Submitter } from '../submitters/entities/submitter.entity';
import { Template } from '../templates/entities/template.entity';
import { UserConfig } from '../users/entities/user-config.entity';
import { User } from '../users/entities/user.entity';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { SubmissionEvent } from './entities/submission-event.entity';
import { Submission } from './entities/submission.entity';
import { OwnerAutoSignService } from './owner-auto-sign.service';
function setup() {
  const user: User = Object.assign(new User(), {
    id: 'owner',
    accountId: 'tenant',
    email: 'owner@example.test',
    firstName: 'First',
    lastName: 'Last',
  });
  const configs = {
    find: jest.fn<Promise<AccountConfig[]>, [unknown]>().mockResolvedValue([]),
  };
  const users = {
    findOne: jest.fn<Promise<User | null>, [unknown]>().mockResolvedValue(null),
  };
  const assets = {
    findOneBy: jest
      .fn<Promise<UserConfig | null>, [unknown]>()
      .mockResolvedValue(null),
  };
  const storage = {
    findRecordAttachments: jest
      .fn<Promise<StorageAttachment[]>, [unknown]>()
      .mockResolvedValue([]),
    cloneAttachment: jest.fn(
      (input: Parameters<StorageService['cloneAttachment']>[0]) =>
        Promise.resolve(
          Object.assign(new StorageAttachment(), input.sourceAttachment, {
            uuid: `cloned-${input.sourceAttachment.uuid}`,
          }),
        ),
    ),
  };
  const template: Template = Object.assign(new Template(), {
    id: 'template',
    preferences: {},
    fields: [],
    submitters: [{ uuid: 'owner-role', name: 'Owner' }],
  });
  const submission: Submission = Object.assign(new Submission(), {
    id: 'submission',
    template,
    templateFields: null,
    templateSubmitters: null,
    submitters: [],
  });
  const submitter: Submitter = Object.assign(new Submitter(), {
    id: 'signer',
    accountId: 'tenant',
    submissionId: 'submission',
    submission,
    uuid: 'owner-role',
    name: 'Owner',
    email: 'owner@example.test',
    values: {},
    metadata: {},
    preferences: { use_saved_signature: true },
    completedAt: null,
  });
  submission.submitters = [submitter];
  const submitters = {
    save: jest.fn((value: Submitter) => Promise.resolve(value)),
  };
  const events = {
    create: jest.fn((input: Partial<SubmissionEvent>) =>
      Object.assign(new SubmissionEvent(), input),
    ),
    save: jest.fn((value: SubmissionEvent) => Promise.resolve(value)),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === Submitter ? submitters : events,
    ),
  } as unknown as EntityManager;
  const service = new OwnerAutoSignService(
    configs as unknown as Repository<AccountConfig>,
    users as unknown as Repository<User>,
    assets as unknown as Repository<UserConfig>,
    storage as unknown as StorageService,
  );
  return {
    service,
    user,
    configs,
    users,
    assets,
    storage,
    template,
    submission,
    submitter,
    submitters,
    events,
    manager,
  };
}
it('leaves disabled owner auto-sign input unchanged and honors explicit input overrides over template/account settings', async () => {
  const { service, user, configs, template } = setup();
  const input: CreateSubmissionDto = {
    template_id: 'template',
    submitters: [{ email: 'customer@example.test' }],
  };
  expect(await service.prepareSubmittersInput(user, template, input)).toBe(
    input,
  );
  configs.find.mockResolvedValue([
    Object.assign(new AccountConfig(), {
      key: 'auto_sign_owner_enabled',
      value: true,
    }),
    Object.assign(new AccountConfig(), {
      key: 'auto_sign_owner_role',
      value: 'Account role',
    }),
    Object.assign(new AccountConfig(), {
      key: 'auto_sign_owner_send_email',
      value: true,
    }),
  ]);
  expect(
    await service.prepareSubmittersInput(user, template, {
      ...input,
      auto_sign_owner: false,
    }),
  ).toEqual({ ...input, auto_sign_owner: false });
  template.preferences = { auto_sign_owner_enabled: false };
  expect(await service.prepareSubmittersInput(user, template, input)).toBe(
    input,
  );
  template.preferences = {
    auto_sign_owner_enabled: true,
    auto_sign_owner_role: ' Template role ',
    auto_sign_owner_send_email: false,
  };
  const prepared = await service.prepareSubmittersInput(user, template, {
    ...input,
    auto_sign_owner_role: ' Explicit role ',
  });
  expect(prepared.submitters[0]).toMatchObject({
    role: 'Explicit role',
    completed_by_user_id: 'owner',
    email: 'owner@example.test',
    name: 'First Last',
    send_email: false,
    send_sms: false,
    use_saved_signature: true,
  });
  template.preferences = {};
  expect(
    (await service.prepareSubmittersInput(user, template, input)).submitters[0],
  ).toMatchObject({ role: 'Account role', send_email: true });
});
it('uses fallback owner role/name and does not silently replace an existing non-owner-signature recipient', async () => {
  const { service, user, template } = setup();
  user.firstName = null;
  user.lastName = null;
  const input: CreateSubmissionDto = {
    template_id: 'template',
    auto_sign_owner: true,
    submitters: [{ email: 'customer@example.test' }],
  };
  expect(
    (await service.prepareSubmittersInput(user, template, input)).submitters[0],
  ).toMatchObject({ role: 'First Party', name: 'owner@example.test' });
  await expect(
    service.prepareSubmittersInput(user, template, {
      ...input,
      submitters: [{ role: ' first party ', email: 'someone@example.test' }],
    }),
  ).rejects.toMatchObject({ status: 422 });
});
it('fills an existing owner role while preserving explicit signing-user and email preferences', async () => {
  const { service, user, template } = setup();
  const input: CreateSubmissionDto = {
    template_id: 'template',
    auto_sign_owner: true,
    auto_sign_owner_role: 'Owner',
    submitters: [
      { role: ' Owner ', use_saved_signature: true },
      { role: 'Customer', email: 'customer@example.test' },
    ],
  };
  expect(
    (await service.prepareSubmittersInput(user, template, input)).submitters,
  ).toMatchObject([
    {
      completed_by_user_id: 'owner',
      send_email: false,
      use_saved_signature: true,
    },
    { role: 'Customer', email: 'customer@example.test' },
  ]);
  input.submitters[0].completed_by_user_id = 'other';
  input.submitters[0].send_email = true;
  expect(
    (await service.prepareSubmittersInput(user, template, input)).submitters[0],
  ).toMatchObject({ completed_by_user_id: 'other', send_email: true });
});
it('clones saved signature/initial assets, fills dates and records owner completion with request metadata', async () => {
  const {
    service,
    user,
    assets,
    storage,
    template,
    submission,
    submitter,
    submitters,
    events,
    manager,
  } = setup();
  template.fields = [
    { uuid: 'signature', type: 'signature', submitter_uuid: 'owner-role' },
    { uuid: 'initials', type: 'initials', submitter_uuid: 'owner-role' },
    { uuid: 'date', type: 'date', submitter_uuid: 'owner-role' },
    { uuid: 'text', type: 'text', submitter_uuid: 'owner-role' },
    {
      uuid: 'optional',
      type: 'text',
      required: false,
      submitter_uuid: 'owner-role',
    },
    { uuid: 'readonly', readonly: true, submitter_uuid: 'owner-role' },
    { type: 'text', submitter_uuid: 'owner-role' },
    { uuid: 'other', type: 'signature', submitter_uuid: 'other' },
  ];
  submitter.values = { text: 'Already set', date: '' };
  assets.findOneBy.mockImplementation((options) =>
    Promise.resolve(
      Object.assign(new UserConfig(), {
        value: (options as { key: string }).key,
      }),
    ),
  );
  storage.findRecordAttachments.mockImplementation((options) => {
    const key = (options as { name: string }).name;
    return Promise.resolve([
      Object.assign(new StorageAttachment(), {
        uuid: key,
        blob: new StorageBlob(),
      }),
    ]);
  });
  await service.completeSavedSignatureSubmitters({
    manager,
    submission,
    user,
    metadata: { ip: '127.0.0.1' },
  });
  expect(submitter.values).toMatchObject({
    signature: 'cloned-signature',
    initials: 'cloned-initials',
    text: 'Already set',
    date: new Date().toISOString().slice(0, 10),
  });
  expect(submitter.completedAt).toBeInstanceOf(Date);
  expect(submitter.metadata).toMatchObject({
    auto_signed: true,
    auto_signed_by_user_id: 'owner',
    auto_signed_role: 'Owner',
  });
  expect(storage.cloneAttachment).toHaveBeenCalledWith(
    expect.objectContaining({
      recordType: 'Submitter',
      recordId: 'signer',
      name: 'attachments',
    }),
  );
  expect(submitters.save).toHaveBeenCalledWith(submitter);
  expect(events.create).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'api_complete_form',
      data: {
        ip: '127.0.0.1',
        auto_signed: true,
        auto_signed_by_user_id: 'owner',
        auto_signed_role: 'Owner',
      },
    }),
  );
});
it('requires an approved saved asset that matches the profile preference, including optional signature fields', async () => {
  const { service, user, template, submission, assets, storage, manager } =
    setup();
  template.fields = [
    {
      uuid: 'signature',
      type: 'signature',
      required: false,
      submitter_uuid: 'owner-role',
    },
  ];
  await expect(
    service.completeSavedSignatureSubmitters({ manager, submission, user }),
  ).rejects.toMatchObject({ status: 422 });
  assets.findOneBy.mockResolvedValue(
    Object.assign(new UserConfig(), { value: 'approved' }),
  );
  storage.findRecordAttachments.mockResolvedValue([
    Object.assign(new StorageAttachment(), { uuid: 'unapproved' }),
  ]);
  await expect(
    service.completeSavedSignatureSubmitters({ manager, submission, user }),
  ).rejects.toMatchObject({ status: 422 });
});
it.each([undefined, null, '', []])(
  'blocks missing required owner values (%s) before recording completion',
  async (value) => {
    const {
      service,
      user,
      template,
      submission,
      submitter,
      submitters,
      manager,
    } = setup();
    template.fields = [
      {
        uuid: 'required',
        name: 'Required owner value',
        type: 'text',
        submitter_uuid: 'owner-role',
      },
    ];
    submitter.values = { required: value };
    await expect(
      service.completeSavedSignatureSubmitters({ manager, submission, user }),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        error: expect.stringContaining('Required owner value') as unknown,
      },
    });
    expect(submitter.completedAt).toBeNull();
    expect(submitters.save).not.toHaveBeenCalled();
  },
);
it('restricts an explicit signing identity to the authenticated account and preserves existing completion/date values', async () => {
  const { service, user, users, template, submission, submitter, manager } =
    setup();
  submitter.preferences.completed_by_user_id = ' other ';
  await expect(
    service.completeSavedSignatureSubmitters({ manager, submission, user }),
  ).rejects.toMatchObject({ status: 422 });
  expect(users.findOne).toHaveBeenCalledWith({
    where: { accountId: 'tenant', id: 'other' },
  });
  users.findOne.mockResolvedValue(Object.assign(new User(), { id: 'other' }));
  const completedAt = new Date('2026-01-01');
  submitter.completedAt = completedAt;
  template.fields = [
    { uuid: 'date', type: 'date', submitter_uuid: 'owner-role' },
  ];
  submitter.values = { date: '2025-12-01' };
  await service.completeSavedSignatureSubmitters({ manager, submission, user });
  expect(submitter.completedAt).toBe(completedAt);
  expect(submitter.values.date).toBe('2025-12-01');
  expect(submitter.metadata.auto_signed_by_user_id).toBe('other');
});
it('skips unselected/absent submitters and uses snapshot fields/roles with signer identity fallbacks', async () => {
  const { service, user, submission, submitter, submitters, manager } = setup();
  submitter.preferences.use_saved_signature = false;
  await service.completeSavedSignatureSubmitters({ manager, submission, user });
  expect(submitters.save).not.toHaveBeenCalled();
  submitter.preferences = {
    use_saved_signature: true,
    completed_by_user_id: 'owner',
  };
  submission.templateFields = [];
  submission.templateSubmitters = [];
  submitter.name = null;
  await service.completeSavedSignatureSubmitters({ manager, submission, user });
  expect(submitter.metadata.auto_signed_role).toBe('owner@example.test');
  submitter.name = null;
  submitter.email = null;
  submission.template = null;
  submission.templateFields = null;
  submission.templateSubmitters = null;
  await service.completeSavedSignatureSubmitters({ manager, submission, user });
  expect(submitter.metadata.auto_signed_role).toBe('Submitter');
  submission.submitters = undefined as unknown as Submitter[];
  await service.completeSavedSignatureSubmitters({ manager, submission, user });
});
