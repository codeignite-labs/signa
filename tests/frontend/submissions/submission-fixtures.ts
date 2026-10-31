import type {
  SubmissionResponse,
  SubmissionSubmitterResponse,
  SubmissionEventLogItem,
  SubmissionMailEventResponse,
} from "../../../apps/frontend/lib/api/submissions";
export const party: SubmissionSubmitterResponse = {
  id: "party",
  submission_id: "48",
  uuid: "signer",
  email: "casey@example.test",
  slug: "signer-link",
  name: "Casey Example",
  role: "Customer",
  status: "pending",
  values: [{ field: "Name", value: "Casey Example" }],
};
export function submission(
  overrides: Partial<SubmissionResponse> = {},
): SubmissionResponse {
  return {
    id: "48",
    name: "Customer agreement",
    slug: "submission",
    source: "web",
    submitters_order: "preserved",
    expire_at: null,
    created_at: "2026-10-30T12:00:00Z",
    updated_at: "2026-10-30T12:00:00Z",
    archived_at: null,
    status: "pending",
    completed_at: null,
    audit_log_url: "/audit.pdf",
    combined_document_url: "/combined.pdf",
    variables: {},
    submitters: [party],
    template: {
      id: "template",
      name: "Agreement template",
      external_id: null,
      folder_name: "Contracts",
      created_at: "2026-10-30T12:00:00Z",
      updated_at: "2026-10-30T12:00:00Z",
    },
    created_by_user: null,
    fields: [
      {
        uuid: "field",
        name: "Name",
        type: "text",
        submitter_uuid: "signer",
        areas: [
          {
            attachment_uuid: "document",
            page: 0,
            x: 0.1,
            y: 0.2,
            w: 0.3,
            h: 0.05,
          },
        ],
      },
    ],
    ...overrides,
  };
}
export const document = {
  id: "document",
  uuid: "document",
  url: "/template.pdf",
  preview_image_url: "/page.png",
  filename: "Agreement.pdf",
  preview_images: [
    {
      id: "page",
      url: "/page.png",
      filename: "page.png",
      metadata: { width: 1000, height: 1400 },
    },
  ],
};
export function event(
  overrides: Partial<SubmissionEventLogItem> = {},
): SubmissionEventLogItem {
  return {
    id: "event",
    event_type: "form.completed",
    event_timestamp: "2026-10-30T12:00:00Z",
    submitter_id: "party",
    icon: "check",
    title: "Form completed",
    actor: "Casey Example",
    device: "mobile",
    browser: "Chrome",
    os: "Android",
    ip: "192.0.2.1",
    timezone: "Africa/Nairobi",
    message: "Customer signed the agreement.",
    data: {},
    ...overrides,
  };
}
export function mailEvent(
  overrides: Partial<SubmissionMailEventResponse> = {},
): SubmissionMailEventResponse {
  return {
    id: "mail",
    template: "completed",
    subject: "Your completed agreement",
    recipients: "casey@example.test",
    status: "sent",
    message_id: null,
    submitter_id: "party",
    attempt: 1,
    job_id: null,
    last_error_message: null,
    provider_response: null,
    sent_at: "2026-10-30T12:00:00Z",
    skipped_at: null,
    failed_at: null,
    created_at: "2026-10-30T12:00:00Z",
    ...overrides,
  };
}
