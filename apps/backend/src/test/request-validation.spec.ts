import { plainToInstance, ClassConstructor } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LoginDto } from '../auth/dto/login.dto';
import { RegisterDto } from '../auth/dto/register.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { ListTemplatesQueryDto } from '../templates/dto/list-templates-query.dto';
import { ListSubmissionsQueryDto } from '../submissions/dto/list-submissions-query.dto';
import { ListSubmittersQueryDto } from '../submitters/dto/list-submitters-query.dto';
import { DeleteTemplateQueryDto } from '../templates/dto/delete-template-query.dto';
import { DeleteSubmissionQueryDto } from '../submissions/dto/delete-submission-query.dto';
import { UpdateTemplateDto } from '../templates/dto/update-template.dto';
import { UpdateTemplateDocumentsDto } from '../templates/dto/update-template-documents.dto';
import { CreateTeamMemberDto } from '../teams/dto/create-team-member.dto';
import { CreateWebhookUrlDto } from '../webhooks/dto/webhook-url.dto';
import { CreateSubmissionDto } from '../submissions/dto/create-submission.dto';
function errors(type: ClassConstructor<object>, input: object) {
  return validateSync(plainToInstance(type, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}
it.each([LoginDto, RegisterDto, CreateUserDto])(
  'requires a valid email in %p',
  (type) => {
    for (const email of ['', 'invalid', 'missing@'])
      expect(
        errors(type, {
          email,
          password: 'long-password',
          first_name: 'A',
          last_name: 'B',
          account_name: 'Example',
        }).some((error) => error.property === 'email'),
      ).toBe(true);
  },
);
it('rejects short credentials and malformed MFA attempts while allowing formatted OTPs', () => {
  expect(
    errors(LoginDto, { email: 'user@example.test', password: 'short' }),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ property: 'password' })]),
  );
  expect(
    errors(LoginDto, {
      email: 'user@example.test',
      password: 'long-password',
      otp_attempt: 'ABCDEF',
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ property: 'otp_attempt' }),
    ]),
  );
  expect(
    errors(LoginDto, {
      email: 'user@example.test',
      password: 'long-password',
      otp_attempt: '123-456',
    }),
  ).toEqual([]);
});
it.each(['admin', 'editor', 'agent', 'member', 'viewer'])(
  'accepts only supported user roles including %s',
  (role) => {
    expect(errors(CreateUserDto, { email: 'user@example.test', role })).toEqual(
      [],
    );
  },
);
it('rejects role escalation to unknown roles and unrecognized request fields', () => {
  expect(
    errors(CreateUserDto, { email: 'user@example.test', role: 'superuser' }),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ property: 'role' })]),
  );
  expect(
    errors(CreateUserDto, {
      email: 'user@example.test',
      account_id: 'foreign',
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ property: 'account_id' }),
    ]),
  );
});
it.each([
  ListTemplatesQueryDto,
  ListSubmissionsQueryDto,
  ListSubmittersQueryDto,
])('validates bounded cursor pagination on %p', (type) => {
  expect(errors(type, { limit: '20' })).toEqual([]);
  expect(plainToInstance(type, { limit: '20' }).limit).toBe(20);
  for (const limit of ['0', '-1', '101', 'text', '1.5'])
    expect(
      errors(type, { limit }).some((error) => error.property === 'limit'),
    ).toBe(true);
  expect(errors(type, { limit: '100', before: '42', after: '24' })).toEqual([]);
});
it.each([true, 'true', false, 'false', 'unexpected'])(
  'normalizes DocuSeal query booleans consistently for %p',
  (value) => {
    const expected = value === true || value === 'true';
    for (const type of [ListTemplatesQueryDto, ListSubmissionsQueryDto])
      expect(plainToInstance(type, { archived: value }).archived).toBe(
        expected,
      );
    expect(
      plainToInstance(DeleteTemplateQueryDto, { permanently: value })
        .permanently,
    ).toBe(expected);
    expect(
      plainToInstance(DeleteSubmissionQueryDto, { permanently: value })
        .permanently,
    ).toBe(expected);
    expect(
      plainToInstance(UpdateTemplateDto, {
        shared_link: value,
        archived: value,
      }),
    ).toMatchObject({ shared_link: expected, archived: expected });
    expect(
      plainToInstance(UpdateTemplateDocumentsDto, { merge: value }).merge,
    ).toBe(expected);
  },
);
it.each([42, '42', null, undefined])(
  'normalizes team membership id %p without manufacturing missing ids',
  (user_id) => {
    const member = plainToInstance(CreateTeamMemberDto, { user_id });
    expect(member.user_id).toBe(user_id == null ? user_id : '42');
    expect(validateSync(member).length > 0).toBe(user_id == null);
  },
);
it('validates webhook protocols and event selections including duplicate and unknown events', () => {
  expect(
    errors(CreateWebhookUrlDto, {
      url: 'https://hooks.example.test',
      events: ['form.completed'],
    }),
  ).toEqual([]);
  for (const body of [
    { url: 'not a URL' },
    { url: 'https://hooks.example.test', events: ['unsupported'] },
    {
      url: 'https://hooks.example.test',
      events: ['form.completed', 'form.completed'],
    },
  ])
    expect(errors(CreateWebhookUrlDto, body).length).toBeGreaterThan(0);
});
it('validates nested submitter values and message payloads, not only the submission shell', () => {
  const valid = {
    template_id: '42',
    submitters: [
      {
        email: 'user@example.test',
        role: 'First Party',
        message: { subject: 'Agreement', body: 'Please sign' },
      },
    ],
  };
  expect(errors(CreateSubmissionDto, valid)).toEqual([]);
  expect(
    errors(CreateSubmissionDto, { ...valid, submitters: [{ email: 42 }] }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ property: 'submitters' }),
    ]),
  );
  expect(
    errors(CreateSubmissionDto, { ...valid, message: { subject: '' } }),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ property: 'message' })]),
  );
});
