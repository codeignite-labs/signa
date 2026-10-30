import { buildSubmissionEventLog } from './submission-event-log.mapper';
import { Submission } from './entities/submission.entity';
import { SubmissionEvent } from './entities/submission-event.entity';
import { Submitter } from '../submitters/entities/submitter.entity';
import { User } from '../users/entities/user.entity';
const createdAt = new Date('2026-10-30T10:00:00Z');
function submission() {
  return Object.assign(new Submission(), {
    id: 'submission',
    source: 'public-link',
    createdAt,
  });
}
function event(overrides: Partial<SubmissionEvent> = {}) {
  return Object.assign(new SubmissionEvent(), {
    id: 'event',
    eventType: 'custom_event',
    eventTimestamp: new Date('2026-10-31T10:00:00Z'),
    submitterId: null,
    data: {},
    ...overrides,
  });
}
it('renders a creation entry when optional relations have not been loaded', () => {
  expect(buildSubmissionEventLog(submission())).toEqual([
    {
      id: 'submission-submission-created',
      actor: null,
      browser: null,
      data: { source: 'public-link' },
      device: null,
      event_timestamp: createdAt,
      event_type: 'submission_created',
      icon: 'file_text',
      ip: null,
      message: 'Submission created via Public Link',
      os: null,
      submitter_id: null,
      timezone: null,
      title: 'Submission created',
    },
  ]);
});
it('uses the creation actor and sorts persisted events by timestamp rather than relation order', () => {
  const value = submission();
  value.createdByUser = Object.assign(new User(), {
    email: 'owner@example.test',
  });
  value.submissionEvents = [
    event({ id: 'late' }),
    event({ id: 'early', eventTimestamp: new Date('2026-10-29') }),
  ];
  const result = buildSubmissionEventLog(value);
  expect(result.map((entry) => entry.id)).toEqual([
    'early',
    'submission-submission-created',
    'late',
  ]);
  expect(result[1].message).toBe(
    'Submission created by owner@example.test via Public Link',
  );
});
it.each([
  [
    { name: 'Casey', email: 'casey@example.test', phone: '+14155552671' },
    {},
    'Casey',
  ],
  [
    { name: null, email: 'casey@example.test', phone: '+14155552671' },
    {},
    'casey@example.test',
  ],
  [{ name: null, email: null, phone: '+14155552671' }, {}, '+14155552671'],
  [{ name: null, email: null, phone: null }, {}, null],
  [{ name: 'Casey' }, { phone: '+442079460018' }, '+442079460018'],
])(
  'resolves the event actor using captured phone and available signer identity %j',
  (identity, data, actor) => {
    const value = submission();
    value.submitters = [
      Object.assign(new Submitter(), { id: 'signer', ...identity }),
    ];
    value.submissionEvents = [event({ submitterId: 'signer', data })];
    expect(buildSubmissionEventLog(value)[1]).toMatchObject({
      actor,
      title: 'Custom Event',
      icon: 'circle_dot',
      message: actor ? `Custom Event by ${actor}` : 'Custom Event',
    });
  },
);
it('renders sent messages as addressed to the actor and trims supported client metadata', () => {
  const value = submission();
  value.submissionEvents = [
    event({
      eventType: 'send_2fa_sms',
      data: {
        phone: '+14155552671',
        browser: ' Chrome ',
        os: ' Android ',
        ip: ' 127.0.0.1 ',
        timezone: ' UTC ',
        device_type: ' embedded-webview ',
      },
    }),
  ];
  expect(buildSubmissionEventLog(value)[1]).toMatchObject({
    title: '2FA SMS sent',
    icon: '2fa',
    message: '2FA SMS sent to +14155552671',
    browser: 'Chrome',
    os: 'Android',
    ip: '127.0.0.1',
    timezone: 'UTC',
    device: 'embedded-webview',
  });
});
it.each([
  ['Mozilla iPad', 'tablet'],
  ['Android Chrome', 'mobile'],
  ['iPhone Safari', 'mobile'],
  ['Mozilla Linux', 'desktop'],
  ['', null],
  ['   ', null],
  [42, null],
])('detects device from UA %s', (ua, device) => {
  const value = submission();
  value.submissionEvents = [
    event({ data: { ua, browser: 12, ip: ' ', os: null } }),
  ];
  expect(buildSubmissionEventLog(value)[1]).toMatchObject({
    device,
    browser: null,
    ip: null,
    os: null,
  });
});
it('tolerates a legacy event with absent data and a missing submitter relation', () => {
  const value = submission();
  value.submissionEvents = [
    event({ submitterId: 'removed-signer', data: undefined as never }),
  ];
  expect(buildSubmissionEventLog(value)[1]).toMatchObject({
    actor: null,
    data: {},
    device: null,
    message: 'Custom Event',
  });
});
