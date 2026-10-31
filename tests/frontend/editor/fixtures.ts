import type {
  TemplateDocument,
  TemplateResponse,
} from "../../../apps/frontend/lib/api/templates";
import type { TemplateEditorField } from "../../../apps/frontend/app/templates/[id]/edit/_lib/template-editor-model";
export const pageArea = {
  attachment_uuid: "doc",
  page: 0,
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.04,
};
export const signer = { uuid: "signer", name: "First Party" };
export const secondSigner = { uuid: "second", name: "Second Party" };
export const document: TemplateDocument = {
  id: "doc",
  uuid: "doc",
  url: "/doc.pdf",
  preview_image_url: "/preview.png",
  filename: "agreement.pdf",
  preview_images: [0, 1, 2].map((index) => ({
    id: String(index),
    url: "/page.png",
    filename: "page.png",
    metadata: { width: 600, height: 800 },
  })),
};
export function editorField(
  uuid = "field",
  overrides: Partial<TemplateEditorField> = {},
): TemplateEditorField {
  return {
    uuid,
    type: "text",
    name: uuid,
    submitter_uuid: signer.uuid,
    areas: [{ ...pageArea }],
    ...overrides,
  };
}
export function templateFixture(
  overrides: Partial<TemplateResponse> = {},
): TemplateResponse {
  return {
    id: "template",
    name: "Agreement",
    archived_at: null,
    fields: [],
    preferences: {},
    schema: [{ attachment_uuid: "doc" }],
    slug: "public",
    source: "pdf",
    submitters: [signer],
    created_at: "",
    updated_at: "",
    author_id: "user",
    external_id: null,
    folder_id: "folder",
    shared_link: false,
    shared_with_test_mode: false,
    application_key: null,
    folder_name: "",
    variables_schema: null,
    author: {
      id: "user",
      email: "user@example.test",
      first_name: null,
      last_name: null,
    },
    documents: [document],
    ...overrides,
  };
}
