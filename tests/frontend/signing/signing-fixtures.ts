import type {
  SigningField,
  SigningForm,
} from "../../../apps/frontend/lib/api/signing";
export const textField: SigningField = {
  uuid: "field-1",
  type: "text",
  name: "Full name",
  required: true,
  areas: [
    { attachment_uuid: "document", page: 0, x: 0.1, y: 0.1, w: 0.4, h: 0.05 },
  ],
};
export function signingForm(overrides: Partial<SigningForm> = {}): SigningForm {
  return {
    attachments: [],
    submission_id: "submission",
    title: "Customer agreement",
    submitter: {
      id: "signer",
      slug: "slug",
      uuid: "signer-uuid",
      name: "Casey Example",
      email: "casey@example.test",
      role: "First Party",
      completed_at: null,
      declined_at: null,
    },
    documents: [
      {
        id: "document",
        uuid: "document",
        filename: "agreement.pdf",
        name: "Agreement",
        url: "/document.pdf",
        preview_images: [
          {
            id: "page",
            url: "/page.png",
            filename: "page.png",
            metadata: { width: 1000, height: 1400 },
          },
        ],
      },
    ],
    fields: [textField],
    values: {},
    readonly_values: {},
    configs: {
      with_confetti: false,
      with_typed_signature: true,
      with_decline: true,
      with_delegate: false,
      require_signing_reason: false,
      with_signature_id: false,
      prefill_signature: false,
      download_links_expire: false,
      download_links_auth: false,
      combine_pdf_result: true,
      flatten_result_pdf: true,
      force_mfa: false,
      completed_message: {},
      completed_button: {},
    },
    ...overrides,
  };
}
export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
