export type DocsScreenshot = {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
};

const screenshot = (
  file: string,
  alt: string,
  caption: string,
): DocsScreenshot => ({
  src: `/images/docs/${file}.jpg`,
  alt,
  caption,
  width: 1280,
  height: 800,
});

export const docsScreenshots = {
  templates: screenshot(
    "templates",
    "Signa template workspace with upload, create, search, and folder controls",
    "Templates is the starting point. Use Upload for an existing document, Create for a new template, and New folder to organize the library.",
  ),
  upload: screenshot(
    "upload",
    "New document template dialog with upload and Google Drive source options",
    "Choose the document source, then wait for its page previews to render.",
  ),
  editor: {
    ...screenshot(
      "editor",
      "Signa template editor with signer roles, field palette, and PDF page",
      "Select the signer role, place fields on the PDF, and use the preview before sending.",
    ),
    width: 1864,
  },
  bulkImport: screenshot(
    "bulk-import",
    "Bulk recipient import with CSV and XLSX options",
    "Choose CSV or XLSX, use the sample format, and review the imported recipients before sending.",
  ),
  recipients: screenshot(
    "recipients",
    "Send to recipients dialog with delivery tabs and recipient controls",
    "Choose the delivery method, enter the recipients for each role, and review the request before sending.",
  ),
  submission: {
    ...screenshot(
      "submission",
      "Signa submission details showing participant status and document preview",
      "Use the submission record to review participants, documents, and activity. This example is awaiting a signature; completed-document actions depend on status and your permissions.",
    ),
    width: 1849,
  },
  branding: {
    ...screenshot(
      "branding",
      "Personalization settings with logo, primary color, business title, and theme previews",
      "Upload or replace the logo, choose a primary color, and compare the light and dark previews. Example workspace labels are used in these screenshots.",
    ),
    height: 1120,
  },
  account: screenshot(
    "account",
    "Account settings with organization name and signing security preferences",
    "Set the organization name in Account. Review the signing and download preferences before applying your policy.",
  ),
  users: screenshot(
    "users",
    "New user dialog with email, role, team, and optional password fields",
    "Enter the email and account role. Existing login identities receive an invitation to join this workspace.",
  ),
  teams: screenshot(
    "teams",
    "Signa team settings and new team action",
    "Create a named team, then open View to manage its members and invitations.",
  ),
  certificates: {
    ...screenshot(
      "certificates",
      "E-Signature settings showing signing identities, timestamp service, and trusted certificate authorities",
      "Select the active signing identity and configure its timestamp service. Trust certificates are managed separately from private signing keys.",
    ),
    height: 960,
  },
  notifications: screenshot(
    "notifications",
    "Notification settings for signature requests and reminders",
    "Choose the events and reminders that should produce notifications in this workspace.",
  ),
  integrations: screenshot(
    "integrations",
    "Signa integrations settings with available provider connections",
    "Open the appropriate provider to connect it. Connection availability depends on the deployment configuration.",
  ),
} satisfies Record<string, DocsScreenshot>;

export const articleScreenshots: Record<
  string,
  Record<string, keyof typeof docsScreenshots>
> = {
  "quick-start": {
    "create-workspace": "templates",
    "prepare-template": "editor",
    "send-request": "recipients",
    "confirm-completion": "submission",
    identity: "account",
    governance: "users",
  },
  "create-a-template": {
    "choose-source": "templates",
    upload: "upload",
    "manage-template": "editor",
  },
  "add-fields-and-signer-roles": { fields: "editor" },
  "send-documents-to-recipients": {
    "address-request": "recipients",
    "delivery-check": "submission",
  },
  "track-a-signature-request": { status: "submission" },
  "sign-yourself": { start: "editor" },
  "bulk-send-with-a-recipient-list": { import: "bulkImport" },
  "download-and-verify-completed-documents": {
    download: "submission",
    verify: "certificates",
  },
  "use-embedded-text-field-tags": { detect: "editor" },
  "create-dynamic-docx-templates": { generate: "editor" },
  "pre-fill-document-fields-with-api": { test: "editor" },
  "verify-signed-pdfs": { verify: "certificates" },
  "personalize-branding-and-email": { logo: "branding" },
  "create-folders": { manage: "templates" },
  "manage-users": { invite: "users" },
  "manage-teams": { create: "teams" },
  "configure-notifications": { reminders: "notifications" },
  "configure-security-preferences": { authentication: "account" },
  "configure-signing-certificates": { certificates: "certificates" },
  "connect-integrations": { email: "integrations" },
  troubleshooting: { preview: "editor", delivery: "submission" },
};
