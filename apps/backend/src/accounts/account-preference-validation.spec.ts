import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  UpdateAccountPreferencesDto,
  UpdateSubmitterRemindersDto,
  UpdateAccountEmailTemplateDto,
  UpdateDocumentsCopyEmailDto,
  UpdateCompletedEmailDto,
  UpdateCompletedMessageDto,
  UpdateCompletedButtonDto,
} from './dto/update-account-preferences.dto';
it('constructs nested preference DTOs and validates their documented values', () => {
  const input = {
    submitter_reminders: { first_duration: 'one_hour', second_duration: null },
    submitter_invitation_email: {
      subject: 'Please sign',
      body: 'Dear {submitter.name}',
    },
    submitter_documents_copy_email: {
      enabled: true,
      attach_documents: true,
      attach_audit_log: false,
    },
    submitter_completed_email: { subject: 'Completed', attach_documents: true },
    form_completed_message: { title: 'Thank you', body: 'Your copy is ready.' },
    form_completed_button: { title: 'Continue', url: 'https://example.test' },
  };
  const value = plainToInstance(UpdateAccountPreferencesDto, input);
  expect(validateSync(value)).toEqual([]);
  for (const [key, type] of [
    ['submitter_reminders', UpdateSubmitterRemindersDto],
    ['submitter_invitation_email', UpdateAccountEmailTemplateDto],
    ['submitter_documents_copy_email', UpdateDocumentsCopyEmailDto],
    ['submitter_completed_email', UpdateCompletedEmailDto],
    ['form_completed_message', UpdateCompletedMessageDto],
    ['form_completed_button', UpdateCompletedButtonDto],
  ] as const)
    expect(value[key]).toBeInstanceOf(type);
});
it('rejects invalid nested boolean, duration and redirect fields', () => {
  const value = plainToInstance(UpdateAccountPreferencesDto, {
    submitter_reminders: { first_duration: 'yesterday' },
    submitter_documents_copy_email: { attach_documents: 'yes' },
    form_completed_button: { url: 'javascript:alert(1)' },
  });
  expect(validateSync(value).map((error) => error.property)).toEqual(
    expect.arrayContaining([
      'submitter_reminders',
      'submitter_documents_copy_email',
      'form_completed_button',
    ]),
  );
});
