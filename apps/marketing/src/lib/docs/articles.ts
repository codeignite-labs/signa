import type { BundledLanguage } from "shiki";

export type DocsArticleCode = {
  language: BundledLanguage;
  title: string;
  value: string;
};

export type DocsArticleStep = {
  body: string;
  title: string;
};

export type DocsArticleSection = {
  bullets?: string[];
  code?: DocsArticleCode;
  id: string;
  note?: string;
  paragraphs?: string[];
  steps?: DocsArticleStep[];
  title: string;
  warning?: string;
};

export type DocsArticle = {
  audience: string;
  category: string;
  description: string;
  estimatedTime: string;
  image?: string;
  outcomes: string[];
  prerequisites: string[];
  related: Array<{ href: string; label: string }>;
  sections: DocsArticleSection[];
  slug: string;
  title: string;
};

export const guideArticles: DocsArticle[] = [
  {
    audience: "Workspace owners and first-time senders",
    category: "Getting started",
    description:
      "Create a workspace, prepare a reusable template, send a request, and confirm the completed document.",
    estimatedTime: "15 minutes",
    outcomes: [
      "A reusable template with at least one signer role",
      "A delivered signature request",
      "A completed PDF and its activity record",
    ],
    prerequisites: [
      "A Signa owner account or an invitation from a workspace administrator",
      "A PDF, DOCX, or HTML document that you are authorized to send",
      "An email address you can use for a test recipient",
    ],
    related: [
      { href: "/guides/create-a-template", label: "Create a template" },
      {
        href: "/guides/send-documents-to-recipients",
        label: "Send documents to recipients",
      },
      {
        href: "/guides/download-and-verify-completed-documents",
        label: "Download and verify completed documents",
      },
    ],
    sections: [
      {
        id: "create-workspace",
        title: "Create or join a workspace",
        paragraphs: [
          "For a new self-hosted installation, the first registered user becomes the workspace owner. On an existing workspace, use the invitation sent by an administrator.",
          "After signing in, Signa opens the Templates workspace. This is the home for templates, folders, submissions, archived records, and test mode.",
        ],
        note:
          "Use test mode for trial requests. Test records remain visually separated from live signing activity.",
      },
      {
        id: "prepare-template",
        title: "Prepare the first template",
        steps: [
          {
            title: "Upload the source document",
            body: "Select Create, choose Upload, and add a PDF, DOCX, or HTML file. Wait for the page previews to finish rendering before placing fields.",
          },
          {
            title: "Name the signer roles",
            body: "Use role names that describe who acts, such as Client, Company, or Witness. Role names appear again when you address the request.",
          },
          {
            title: "Place required fields",
            body: "Drag signature, text, date, checkbox, initials, or other fields onto the correct page and assign every field to a role.",
          },
          {
            title: "Save and preview",
            body: "Save the template, then open Preview to confirm page rendering, field order, required fields, and mobile usability.",
          },
        ],
      },
      {
        id: "send-request",
        title: "Send a test request",
        steps: [
          {
            title: "Open Add recipients",
            body: "From the template detail page, choose Add recipients and select via Email, via Phone, Detailed, or Upload List.",
          },
          {
            title: "Map each role",
            body: "Enter the recipient for every signer role. Keep preserved order when the second signer should wait for the first signer to finish.",
          },
          {
            title: "Review the invitation",
            body: "Confirm the subject and message, then send. The new submission appears in the template activity and Submissions view.",
          },
        ],
      },
      {
        id: "confirm-completion",
        title: "Confirm the completed record",
        paragraphs: [
          "Open the submission to inspect delivery, view, completion, mail, SMS, and signing events. When every required role finishes, the submission status changes to Completed.",
        ],
        bullets: [
          "Download the completed PDF.",
          "Download or inspect the audit trail.",
          "Confirm every signer and field value is present.",
          "Use PDF verification when certificates or timestamps are part of your policy.",
        ],
      },
    ],
    slug: "quick-start",
    title: "Quick start",
  },
  {
    audience: "Template creators",
    category: "Templates",
    description:
      "Turn a PDF, DOCX, HTML file, or Google Drive document into a reusable signing workflow.",
    estimatedTime: "10 minutes",
    outcomes: ["A named template with rendered pages and assigned signer roles"],
    prerequisites: [
      "Template creation permission",
      "A supported source document that is not password protected",
    ],
    related: [
      {
        href: "/guides/add-fields-and-signer-roles",
        label: "Add fields and signer roles",
      },
      {
        href: "/resources/create-folders",
        label: "Organize templates with folders",
      },
    ],
    sections: [
      {
        id: "choose-source",
        title: "Choose the document source",
        bullets: [
          "Upload accepts PDF, DOCX, and HTML documents.",
          "Google Drive import is available when the deployment owner has configured the Drive Picker integration.",
          "DOCX is best when you need merge variables; PDF is best when page geometry must remain fixed.",
        ],
      },
      {
        id: "upload",
        title: "Upload and render",
        steps: [
          {
            title: "Create the template",
            body: "From Templates, select Create, provide a clear business name, and choose the source.",
          },
          {
            title: "Wait for the previews",
            body: "Signa processes the source and creates page previews. Do not place fields until each page is visible.",
          },
          {
            title: "Check the source",
            body: "Confirm page count, orientation, fonts, and line wrapping. Replace the document before adding fields if the rendering is incorrect.",
          },
        ],
        warning:
          "Password-protected PDFs, XFA forms, and malformed files may not render. Export a standard PDF and upload it again.",
      },
      {
        id: "manage-template",
        title: "Manage the reusable record",
        paragraphs: [
          "The template detail page provides Edit, Add recipients, Clone, Archive, submission export, and activity. Open Edit to replace documents, manage fields, or use Sign yourself.",
          "Clone before making a materially different workflow. Replace documents only when existing field positions can be reviewed again.",
        ],
      },
    ],
    slug: "create-a-template",
    title: "Create a template",
  },
  {
    audience: "Template creators",
    category: "Templates",
    description:
      "Define who signs, place fields, set requirements, and validate the recipient experience.",
    estimatedTime: "12 minutes",
    outcomes: ["A template schema that clearly assigns every input to a signer"],
    prerequisites: ["A template with rendered document pages"],
    related: [
      {
        href: "/guides/use-embedded-text-field-tags",
        label: "Use embedded field tags",
      },
      {
        href: "/guides/send-documents-to-recipients",
        label: "Send documents to recipients",
      },
    ],
    sections: [
      {
        id: "roles",
        title: "Design signer roles first",
        paragraphs: [
          "A role represents a participant in the workflow, not a specific person. Use stable names such as Employee, Manager, Tenant, or Landlord so the same template can be reused.",
        ],
        bullets: [
          "Use one role for each person who must independently complete fields.",
          "Use signing order when a later role should receive the request only after an earlier role completes.",
          "Choose one owner role when your organization should auto-sign before external recipients.",
        ],
      },
      {
        id: "fields",
        title: "Place and configure fields",
        steps: [
          {
            title: "Select a role",
            body: "Choose the intended signer before adding fields so new fields inherit the correct role.",
          },
          {
            title: "Place the field",
            body: "Drag the field onto the document, resize it to match the source, and keep labels from obscuring contract text.",
          },
          {
            title: "Configure behavior",
            body: "Set the field name, requirement, default value, read-only state, options, validation, or signing reason where supported.",
          },
          {
            title: "Repeat and preview",
            body: "Complete every role, save, then preview the form from the perspective of each signer.",
          },
        ],
      },
      {
        id: "quality-check",
        title: "Run a quality check",
        bullets: [
          "Every required field belongs to the correct role.",
          "Fields do not overlap each other or important document text.",
          "Checkbox and radio choices have clear labels.",
          "The signing order matches the business process.",
          "The form is usable at mobile width.",
        ],
      },
    ],
    slug: "add-fields-and-signer-roles",
    title: "Add fields and signer roles",
  },
  {
    audience: "Operations teams and document senders",
    category: "Sending",
    description:
      "Send one or many recipients by email or SMS, preserve signing order, and customize the invitation.",
    estimatedTime: "8 minutes",
    outcomes: ["A signature request addressed to every required role"],
    prerequisites: [
      "A saved template with at least one signer role",
      "SMTP for email delivery or Twilio for SMS delivery",
    ],
    related: [
      {
        href: "/guides/bulk-send-with-a-recipient-list",
        label: "Bulk send with a recipient list",
      },
      {
        href: "/guides/track-a-signature-request",
        label: "Track a signature request",
      },
      {
        href: "/resources/configure-notifications",
        label: "Configure notifications",
      },
    ],
    sections: [
      {
        id: "delivery-mode",
        title: "Choose a delivery mode",
        bullets: [
          "Via Email accepts one or more email addresses.",
          "Via Phone sends signing links through SMS when Twilio is configured.",
          "Detailed captures name, email, phone, and role mapping per recipient.",
          "Upload List imports CSV or XLSX recipient data for repeated requests.",
        ],
      },
      {
        id: "address-request",
        title: "Address and send the request",
        steps: [
          {
            title: "Open the send dialog",
            body: "Select Add recipients from the template detail page.",
          },
          {
            title: "Enter recipients",
            body: "Provide a valid contact for each required role. Review imported rows before continuing.",
          },
          {
            title: "Set signing order",
            body: "Use preserved order for sequential approval. Use random order only when all roles may sign immediately.",
          },
          {
            title: "Review communication",
            body: "Check the invitation subject and message. Variables resolve when the request is sent.",
          },
          {
            title: "Send",
            body: "Submit the request once. Use the submission activity for later resend actions instead of creating accidental duplicates.",
          },
        ],
      },
      {
        id: "delivery-check",
        title: "Confirm delivery",
        paragraphs: [
          "Open the submission after sending. A queued event confirms that Signa accepted the notification; provider delivery or failure events confirm what happened afterward.",
        ],
        warning:
          "A request can be created even when email or SMS is not configured. Always verify provider delivery before assuming a recipient received the link.",
      },
    ],
    slug: "send-documents-to-recipients",
    title: "Send documents to recipients",
  },
  {
    audience: "Senders and support teams",
    category: "Submissions",
    description:
      "Read submission status, inspect delivery and signing events, resend invitations, and resolve stalled requests.",
    estimatedTime: "6 minutes",
    outcomes: ["A verified understanding of where a request is in its lifecycle"],
    prerequisites: ["An existing submission"],
    related: [
      {
        href: "/guides/download-and-verify-completed-documents",
        label: "Download completed documents",
      },
      { href: "/guides/troubleshooting", label: "Troubleshooting" },
    ],
    sections: [
      {
        id: "status",
        title: "Understand submission status",
        bullets: [
          "Pending means at least one required signer has not completed.",
          "Completed means every required role finished.",
          "Declined means a signer rejected the request.",
          "Expired means the configured completion window ended.",
          "Archived hides the record from active lists without deleting its history.",
        ],
      },
      {
        id: "activity",
        title: "Read the activity timeline",
        paragraphs: [
          "The timeline combines request creation, email and SMS delivery, link clicks, form views, signing actions, delegation, decline, completion, and webhook delivery events.",
        ],
        note:
          "Provider events can arrive after the page first loads. Refresh or allow realtime updates before treating a queued message as a failure.",
      },
      {
        id: "recover",
        title: "Recover a stalled request",
        steps: [
          {
            title: "Confirm the recipient",
            body: "Check the email address or phone number and identify the role that is still pending.",
          },
          {
            title: "Inspect delivery",
            body: "Look for provider rejection, bounce, or SMS status events.",
          },
          {
            title: "Resend intentionally",
            body: "Use Resend email for the existing submitter so the audit trail stays attached to the same request.",
          },
          {
            title: "Update only when necessary",
            body: "Correct recipient data or create a replacement request when the original recipient is wrong.",
          },
        ],
      },
    ],
    slug: "track-a-signature-request",
    title: "Track a signature request",
  },
  {
    audience: "Workspace members signing company documents",
    category: "Signing",
    description:
      "Complete an internal or owner role without sending the document to a separate email address.",
    estimatedTime: "5 minutes",
    outcomes: ["A completed owner role or self-signed submission"],
    prerequisites: ["A template with a role intended for the current user"],
    related: [
      {
        href: "/guides/download-and-verify-completed-documents",
        label: "Download and verify completed documents",
      },
    ],
    sections: [
      {
        id: "start",
        title: "Start a self-sign flow",
        steps: [
          {
            title: "Open the template",
            body: "From the template detail page, select Sign yourself.",
          },
          {
            title: "Choose your role",
            body: "Confirm the role that represents you. Do not select an external recipient role.",
          },
          {
            title: "Complete required fields",
            body: "Review the document, provide values, adopt or draw the signature, and give a signing reason when required.",
          },
          {
            title: "Finish",
            body: "Confirm consent and complete the form. Signa records the action in the submission timeline.",
          },
        ],
      },
      {
        id: "owner-auto-sign",
        title: "Use owner auto-sign for repeat workflows",
        paragraphs: [
          "For workflows where the organization always signs a fixed owner role, configure owner auto-sign at the account, template, or submission level. Keep external roles separate and verify the selected owner role before enabling automation.",
        ],
      },
    ],
    slug: "sign-yourself",
    title: "Sign a document yourself",
  },
  {
    audience: "Teams collecting inbound requests",
    category: "Signing",
    description:
      "Publish a start form so a recipient can identify themselves and begin a new submission from a shared link.",
    estimatedTime: "10 minutes",
    outcomes: ["A reusable public start URL for an approved template"],
    prerequisites: ["A completed template and permission to share it"],
    related: [
      {
        href: "/guides/add-fields-and-signer-roles",
        label: "Add fields and signer roles",
      },
      {
        href: "/resources/configure-security-preferences",
        label: "Configure security preferences",
      },
    ],
    sections: [
      {
        id: "configure",
        title: "Configure the start form",
        bullets: [
          "Choose which identity fields to collect, such as name, email, or phone.",
          "Require email verification when the link is public and recipient identity matters.",
          "Review the first signer role because the start form creates a submission for that participant.",
        ],
      },
      {
        id: "publish",
        title: "Publish and test",
        steps: [
          {
            title: "Copy the start URL",
            body: "Use the template shared-link action to obtain the /d/{slug} URL.",
          },
          {
            title: "Open a private browser session",
            body: "Test the link while signed out so you see the recipient experience.",
          },
          {
            title: "Complete identity verification",
            body: "Confirm required fields and one-time email verification behave as expected.",
          },
          {
            title: "Review the created submission",
            body: "Return to Signa and verify the source, submitter identity, activity, and downstream signer order.",
          },
        ],
      },
      {
        id: "share-safely",
        title: "Share the link safely",
        warning:
          "Anyone with a public start URL can initiate the configured workflow. Do not use it for documents that require a pre-approved recipient unless verification and downstream review are in place.",
      },
    ],
    slug: "publish-a-start-form",
    title: "Publish a public start form",
  },
  {
    audience: "Operations teams",
    category: "Sending",
    description:
      "Import CSV or XLSX recipient data, review role mapping, and create multiple requests efficiently.",
    estimatedTime: "10 minutes",
    outcomes: ["Validated recipient rows ready for bulk request creation"],
    prerequisites: [
      "A template with stable signer role names",
      "A CSV or XLSX file containing recipient contact data",
    ],
    related: [
      {
        href: "/guides/send-documents-to-recipients",
        label: "Send documents to recipients",
      },
      {
        href: "/guides/track-a-signature-request",
        label: "Track requests",
      },
    ],
    sections: [
      {
        id: "prepare-list",
        title: "Prepare the recipient list",
        paragraphs: [
          "Download the sample CSV from the Upload List tab and keep its headers. Use one row per request and provide contact columns for each required role.",
        ],
        bullets: [
          "Use valid email addresses and international phone formats.",
          "Keep role column names aligned with the template roles.",
          "Remove blank rows and duplicate recipients.",
          "Start with a small batch in test mode.",
        ],
      },
      {
        id: "import",
        title: "Import and review",
        steps: [
          {
            title: "Choose Upload List",
            body: "Open Add recipients and select Upload List.",
          },
          {
            title: "Select the file",
            body: "Upload CSV or XLSX. Signa parses the rows before requests are created.",
          },
          {
            title: "Resolve row errors",
            body: "Correct missing required contacts, invalid values, and role mapping issues.",
          },
          {
            title: "Confirm the batch",
            body: "Review the final count, delivery mode, signing order, and message before sending.",
          },
        ],
      },
    ],
    slug: "bulk-send-with-a-recipient-list",
    title: "Bulk send with a recipient list",
  },
  {
    audience: "Records teams, auditors, and senders",
    category: "Completion",
    description:
      "Download completed PDFs, inspect the audit trail, and verify cryptographic signature evidence.",
    estimatedTime: "8 minutes",
    outcomes: ["A retained completed record whose integrity has been checked"],
    prerequisites: ["A completed submission"],
    related: [
      { href: "/compliance", label: "Compliance and trust" },
      { href: "/guides/verify-signed-pdfs", label: "Verify signed PDFs" },
    ],
    sections: [
      {
        id: "download",
        title: "Download the completed record",
        steps: [
          {
            title: "Open the submission",
            body: "Use the Submissions view or the template detail page to open the completed request.",
          },
          {
            title: "Review completion",
            body: "Confirm every required signer is completed and the timeline has no unresolved delivery or signing errors.",
          },
          {
            title: "Download documents",
            body: "Download the completed PDF. If the workspace combines the audit log with completed documents, retain the combined file.",
          },
        ],
      },
      {
        id: "verify",
        title: "Verify the PDF",
        paragraphs: [
          "Open Settings > E-Signature and use PDF verification. Review signature validity, signer identity, signing time, certificate chain, timestamp, and long-term validation evidence.",
        ],
        note:
          "A valid document signature proves that signed bytes have not changed. Your legal and retention policy still determines whether the signer authentication and evidence are sufficient for the transaction.",
      },
      {
        id: "retain",
        title: "Retain and export",
        bullets: [
          "Store the completed document and audit evidence according to your retention schedule.",
          "Use CSV or XLSX submission export for operational reporting.",
          "Keep private bucket objects private; use Signa download routes and expiring links.",
        ],
      },
    ],
    slug: "download-and-verify-completed-documents",
    title: "Download and verify completed documents",
  },
  {
    audience: "Template creators and developers",
    category: "Templates",
    description:
      "Use {{...}} tags in source documents to detect fields and reduce repetitive builder work.",
    estimatedTime: "12 minutes",
    outcomes: ["Automatically detected fields with reviewed geometry and roles"],
    prerequisites: ["A PDF or DOCX source that you can edit before upload"],
    related: [
      {
        href: "/guides/add-fields-and-signer-roles",
        label: "Add fields and signer roles",
      },
      {
        href: "/guides/create-dynamic-docx-templates",
        label: "Create dynamic DOCX templates",
      },
    ],
    sections: [
      {
        id: "syntax",
        title: "Add field tags to the source",
        code: {
          language: "html",
          title: "Example field tags",
          value:
            "{{Client signature;role=Client;type=signature}}\n{{Effective date;role=Client;type=date}}\n{{Approved;role=Manager;type=checkbox}}",
        },
        paragraphs: [
          "Each tag provides a field name and can include role and type attributes. Keep tags on one line and leave enough visual space for the resulting field.",
        ],
      },
      {
        id: "detect",
        title: "Detect and review fields",
        steps: [
          {
            title: "Upload the tagged document",
            body: "Create or replace a template document with the tagged source.",
          },
          {
            title: "Run detection",
            body: "Use field detection in the builder after page previews render.",
          },
          {
            title: "Review every result",
            body: "Confirm field type, role, page, size, and required state. Remove false positives.",
          },
          {
            title: "Save and preview",
            body: "Save the schema and test the signer experience before sending.",
          },
        ],
      },
    ],
    slug: "use-embedded-text-field-tags",
    title: "Use embedded text field tags",
  },
  {
    audience: "Document automation teams",
    category: "Templates",
    description:
      "Merge [[variables]] into DOCX content while preserving {{fields}} for recipient input.",
    estimatedTime: "15 minutes",
    outcomes: ["A personalized DOCX workflow with generated preview pages"],
    prerequisites: ["A DOCX source document", "Values to merge at request creation"],
    related: [
      {
        href: "/guides/pre-fill-document-fields-with-api",
        label: "Prefill fields with the API",
      },
      {
        href: "/docs/api#submissions",
        label: "Submission API reference",
      },
    ],
    sections: [
      {
        id: "author",
        title: "Author the DOCX",
        code: {
          language: "html",
          title: "Variables and signer fields",
          value:
            "Agreement number: [[agreement_id]]\nCustomer: [[customer_name]]\nSignature: {{Client signature;role=Client;type=signature}}",
        },
        paragraphs: [
          "Use double square brackets for server-supplied variables and double braces for fields a recipient must complete.",
        ],
      },
      {
        id: "generate",
        title: "Generate and validate",
        steps: [
          {
            title: "Upload the DOCX",
            body: "Create the template through the web UI or DOCX API.",
          },
          {
            title: "Supply variables",
            body: "Pass all required variable names when creating the submission.",
          },
          {
            title: "Inspect the rendered pages",
            body: "Check text wrapping, tables, headers, page breaks, and detected signing fields.",
          },
          {
            title: "Send only after validation",
            body: "Use representative long values in test mode to catch layout overflow.",
          },
        ],
      },
    ],
    slug: "create-dynamic-docx-templates",
    title: "Create dynamic DOCX templates",
  },
  {
    audience: "Developers",
    category: "API",
    description:
      "Create a submission programmatically, map recipients, control delivery, and correlate events with your system.",
    estimatedTime: "15 minutes",
    outcomes: ["A programmatically created signature request"],
    prerequisites: [
      "A scoped API key from Settings > API",
      "A template ID and its signer role names",
    ],
    related: [
      { href: "/docs/api#authentication", label: "API authentication" },
      { href: "/docs/webhooks", label: "Webhooks" },
    ],
    sections: [
      {
        id: "request",
        title: "Create the request",
        code: {
          language: "bash",
          title: "Create a submission",
          value:
            'curl -X POST https://signa.example.com/api/submissions \\\n  -H "X-Auth-Token: $SIGNA_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"template_id":12,"send_email":true,"submitters_order":"preserved","submitters":[{"role":"Client","email":"client@example.com"}],"metadata":{"agreement_id":"AGR-1842"}}\'',
        },
        paragraphs: [
          "Send the key only from a trusted server. Use metadata or external_id to correlate Signa records with your application.",
        ],
      },
      {
        id: "delivery",
        title: "Control delivery and order",
        bullets: [
          "Set send_email false when your application delivers the signing URL.",
          "Enable send_sms only when the deployment has a working SMS provider.",
          "Use preserved order for sequential signing and random for parallel signing.",
          "Use owner auto-sign only with an explicitly selected owner role.",
        ],
      },
      {
        id: "continue",
        title: "Continue the workflow",
        paragraphs: [
          "Store the returned submission and submitter identifiers. Listen for form.completed, form.declined, and submission.completed webhooks, and verify webhook signatures before changing downstream state.",
        ],
      },
    ],
    slug: "send-documents-for-signature-via-api",
    title: "Send documents for signature via API",
  },
  {
    audience: "Developers",
    category: "API",
    description:
      "Supply default or read-only values for text, date, choice, file, image, and signature fields.",
    estimatedTime: "12 minutes",
    outcomes: ["A request whose known values are populated before signing"],
    prerequisites: ["A scoped API key", "The template field names or schema"],
    related: [
      { href: "/docs/api#submitters", label: "Submitter API reference" },
      {
        href: "/resources/manage-attachments-and-storage",
        label: "Attachments and storage",
      },
    ],
    sections: [
      {
        id: "map",
        title: "Map values to field names",
        paragraphs: [
          "Field names in the payload must match the template schema. Prefer stable machine-readable names when templates are part of an integration contract.",
        ],
        bullets: [
          "Text and date fields accept normalized scalar values.",
          "Checkbox, radio, multiple, and select values must match configured options.",
          "File, image, and signature values may require an attachment upload or a supported base64 or remote URL input.",
          "Read-only values remain visible but cannot be edited by the signer.",
        ],
      },
      {
        id: "test",
        title: "Test the signer experience",
        steps: [
          {
            title: "Create a test submission",
            body: "Disable provider delivery or use a controlled recipient.",
          },
          {
            title: "Open the signing URL",
            body: "Confirm values appear on the correct page and belong to the correct signer.",
          },
          {
            title: "Check read-only fields",
            body: "Verify protected values cannot be changed.",
          },
          {
            title: "Complete and inspect",
            body: "Download the PDF and confirm rendered values match the request payload.",
          },
        ],
      },
    ],
    slug: "pre-fill-document-fields-with-api",
    title: "Prefill document fields with the API",
  },
  {
    audience: "Security teams and administrators",
    category: "Verification",
    description:
      "Inspect signatures, certificates, timestamps, revocation evidence, and document integrity.",
    estimatedTime: "10 minutes",
    outcomes: ["A documented verification result for a completed PDF"],
    prerequisites: ["A signed PDF"],
    related: [
      { href: "/compliance", label: "Compliance and trust" },
      {
        href: "/resources/configure-signing-certificates",
        label: "Configure signing certificates",
      },
    ],
    sections: [
      {
        id: "verify",
        title: "Run verification",
        steps: [
          {
            title: "Open E-Signature settings",
            body: "Go to Settings > E-Signature and locate the PDF verification tool.",
          },
          {
            title: "Upload the PDF",
            body: "Use the original completed file. A modified copy may correctly fail integrity validation.",
          },
          {
            title: "Review each signature",
            body: "Check cryptographic validity, signer, signing time, certificate chain, timestamp, and LTV evidence.",
          },
          {
            title: "Record the result",
            body: "Retain the verification output with the business record when your policy requires it.",
          },
        ],
      },
      {
        id: "interpret",
        title: "Interpret common results",
        bullets: [
          "Trusted means the certificate chains to a configured trust root.",
          "External can be cryptographically valid without being trusted by your configured roots.",
          "No signature means the PDF has no supported cryptographic signature even if it contains a visual mark.",
          "A missing timestamp or revocation evidence affects long-term assurance but does not automatically mean the document bytes were changed.",
        ],
      },
    ],
    slug: "verify-signed-pdfs",
    title: "Verify signed PDFs",
  },
  {
    audience: "React and Next.js developers",
    category: "Embedding",
    description:
      "Embed the hosted signing form or template builder and handle lifecycle callbacks in a React application.",
    estimatedTime: "15 minutes",
    outcomes: ["A working embedded Signa surface with completion handling"],
    prerequisites: [
      "A React application",
      "A network-reachable Signa host",
      "A signing URL or builder token created on your server",
    ],
    related: [
      { href: "/docs/embedding", label: "Embedding reference" },
      {
        href: "/guides/send-documents-for-signature-via-api",
        label: "Create requests with the API",
      },
    ],
    sections: [
      {
        id: "install",
        title: "Install and render",
        code: {
          language: "tsx",
          title: "React signing form",
          value:
            'import { SignaForm } from "@signajs/react";\n\nexport function SigningPanel({ signingUrl }: { signingUrl: string }) {\n  return (\n    <SignaForm\n      src={signingUrl}\n      onComplete={(event) => console.log(event)}\n      onDecline={(event) => console.log(event)}\n    />\n  );\n}',
        },
        paragraphs: [
          "Create submissions and builder tokens on your server. Do not expose a Signa API key in browser JavaScript.",
        ],
      },
      {
        id: "production",
        title: "Prepare for production",
        bullets: [
          "Pass host for self-hosted routes when the package cannot infer it.",
          "Pin the embed script or package version.",
          "Handle load, complete, decline, and error callbacks.",
          "Use a stable container height and test mobile keyboard behavior.",
          "Confirm iframe and Content Security Policy rules allow the Signa host.",
        ],
      },
    ],
    slug: "embed-signing-in-react",
    title: "Embed signing in React",
  },
  {
    audience: "Expo and React Native developers",
    category: "Embedding",
    description:
      "Wrap the hosted signing experience in a WebView and connect it to native navigation.",
    estimatedTime: "15 minutes",
    outcomes: ["A mobile signing screen with completion and error handling"],
    prerequisites: [
      "An Expo or React Native application",
      "react-native-webview",
      "A public or LAN-reachable Signa host",
    ],
    related: [
      { href: "/docs/embedding", label: "Embedding reference" },
      { href: "/guides/troubleshooting", label: "Troubleshooting" },
    ],
    sections: [
      {
        id: "install",
        title: "Install the mobile package",
        code: {
          language: "bash",
          title: "Install dependencies",
          value: "pnpm add @signajs/react-native react-native-webview",
        },
      },
      {
        id: "integrate",
        title: "Integrate the signing view",
        bullets: [
          "Pass a complete signing URL or a host plus slug/token.",
          "Navigate only after onComplete or onDecline confirms the hosted event.",
          "Display a native retry state for onError.",
          "Handle downloads outside the WebView when the app needs native file storage.",
        ],
        warning:
          "Android emulators cannot reach a laptop through localhost. Use 10.0.2.2, a LAN address, or a deployed HTTPS host as appropriate.",
      },
    ],
    slug: "embed-signing-in-react-native",
    title: "Embed signing in React Native",
  },
  {
    audience: "All Signa users and operators",
    category: "Troubleshooting",
    description:
      "Diagnose upload, preview, delivery, signing, webhook, authentication, and deployment problems.",
    estimatedTime: "As needed",
    outcomes: ["A narrowed cause and a safe next action"],
    prerequisites: ["Access to the affected record and relevant server logs"],
    related: [
      {
        href: "/resources/deploy-signa-on-premise",
        label: "Deploy Signa on-premise",
      },
      {
        href: "/resources/connect-integrations",
        label: "Connect integrations",
      },
    ],
    sections: [
      {
        id: "preview",
        title: "Document preview is unavailable",
        bullets: [
          "Wait for processing to finish and reload the template once.",
          "Confirm the source is not password protected, XFA-only, or corrupt.",
          "Export a standard PDF and upload it again.",
          "Check backend PDFium processing logs and storage read/write errors.",
          "Verify the generated preview URL is reachable from the browser.",
        ],
      },
      {
        id: "delivery",
        title: "Email or SMS was not delivered",
        bullets: [
          "Confirm SMTP or Twilio is configured and the provider test succeeds.",
          "Inspect submission activity for queued, delivered, rejected, or bounced events.",
          "Verify the recipient address or international phone format.",
          "Resend from the existing submission after correcting the cause.",
        ],
      },
      {
        id: "api",
        title: "API request fails",
        bullets: [
          "401: send a valid key as X-Auth-Token and check whether it was rotated.",
          "403: add the required permission or use the correct team context.",
          "404: verify the account owns the resource and the ID is correct.",
          "422 or 400: compare the payload with the API reference and template schema.",
          "429: honor Retry-After and apply bounded exponential backoff.",
        ],
      },
      {
        id: "embed",
        title: "Embedded signing does not load",
        bullets: [
          "Use a browser-reachable HTTPS host.",
          "Check Content Security Policy, frame ancestors, mixed-content, and CORS errors.",
          "Confirm the signing slug is valid and not completed or expired.",
          "Pin a compatible SDK/script version.",
        ],
      },
      {
        id: "support-bundle",
        title: "Collect useful diagnostic information",
        bullets: [
          "Signa version and deployment method",
          "Affected template, submission, or webhook ID",
          "Timestamp and timezone",
          "Browser and operating system",
          "Sanitized request/response and relevant logs",
          "Exact steps to reproduce without document contents or secrets",
        ],
        warning:
          "Never include API keys, passwords, private signing links, certificate private keys, or unredacted customer documents in support messages.",
      },
    ],
    slug: "troubleshooting",
    title: "Troubleshooting",
  },
];

export const resourceArticles: DocsArticle[] = [
  {
    audience: "New workspace administrators",
    category: "Administration",
    description:
      "Use this checklist to make a new workspace ready for real senders and recipients.",
    estimatedTime: "20 minutes",
    outcomes: ["A configured workspace ready for a controlled pilot"],
    prerequisites: ["Workspace owner or administrator access"],
    related: [
      { href: "/guides/quick-start", label: "Quick start tutorial" },
      {
        href: "/resources/configure-security-preferences",
        label: "Security preferences",
      },
    ],
    sections: [
      {
        id: "identity",
        title: "Set workspace identity",
        bullets: [
          "Set the workspace name, language, timezone, and company logo.",
          "Review invitation, completion, and document-copy email templates.",
          "Set the completed-form message, button, and confetti preference.",
        ],
      },
      {
        id: "delivery",
        title: "Validate delivery",
        bullets: [
          "Send a test email from Settings > Integrations.",
          "Connect Gmail only when account-based sending is required.",
          "Configure SMS before enabling phone delivery or phone verification.",
          "Set reminders and administrator notification recipients.",
        ],
      },
      {
        id: "governance",
        title: "Set access and evidence policy",
        bullets: [
          "Invite users and assign the least-privileged role.",
          "Create teams for separate operational contexts.",
          "Enable MFA, signing reason, download authentication, and retention controls as required.",
          "Configure certificates and trust roots before relying on PDF verification.",
        ],
      },
      {
        id: "pilot",
        title: "Run a pilot",
        paragraphs: [
          "Use test mode to complete one internal and one external multi-party request. Verify rendering, delivery, mobile signing, reminders, completed downloads, audit events, and webhooks before sending production documents.",
        ],
      },
    ],
    slug: "quick-start",
    title: "Workspace onboarding checklist",
  },
  {
    audience: "Workspace administrators and brand owners",
    category: "Branding",
    description:
      "Customize the company logo, invitation copy, completion experience, and reusable email content.",
    estimatedTime: "12 minutes",
    outcomes: ["A consistent recipient experience using approved brand content"],
    prerequisites: ["Administrator access", "An approved logo file"],
    related: [
      {
        href: "/resources/configure-notifications",
        label: "Configure notifications",
      },
      {
        href: "/guides/send-documents-to-recipients",
        label: "Send documents",
      },
    ],
    sections: [
      {
        id: "logo",
        title: "Upload the company logo",
        steps: [
          {
            title: "Open Personalization",
            body: "Go to Settings > Personalization and locate Company Logo.",
          },
          {
            title: "Upload and review",
            body: "Use a clear, high-contrast logo and confirm it remains legible in email and signing contexts.",
          },
          {
            title: "Remove outdated assets",
            body: "Delete the existing logo before replacing it when brand ownership changes.",
          },
        ],
      },
      {
        id: "email",
        title: "Edit email templates",
        paragraphs: [
          "Edit invitation, completed, and document-copy messages using the Markdown editor. Insert only variables offered by the editor for that template.",
        ],
        warning:
          "Do not remove the signing or document link variable from a message that recipients need to act on.",
      },
      {
        id: "completion",
        title: "Customize completion",
        bullets: [
          "Set the completed-form message.",
          "Set the completed-form button label and destination where available.",
          "Enable confetti only when it suits the transaction context.",
          "Complete a test request to verify the final page.",
        ],
      },
    ],
    slug: "personalize-branding-and-email",
    title: "Personalize branding and email",
  },
  {
    audience: "Template owners",
    category: "Templates",
    description:
      "Create nested folders, move and clone templates, and archive inactive workflows.",
    estimatedTime: "7 minutes",
    outcomes: ["A template library organized around clear ownership and use"],
    prerequisites: ["Template management permission"],
    related: [
      { href: "/guides/create-a-template", label: "Create a template" },
      {
        href: "/guides/track-a-signature-request",
        label: "Track submissions",
      },
    ],
    sections: [
      {
        id: "structure",
        title: "Choose a folder structure",
        paragraphs: [
          "Organize by business process or owning team rather than file type. Keep names stable so senders can find the correct workflow.",
        ],
      },
      {
        id: "manage",
        title: "Manage folders and templates",
        bullets: [
          "Use New folder to create a folder at the current level.",
          "Rename folders when the business process changes.",
          "Move templates from the card action menu.",
          "Clone a template before changing it for a different team or use case.",
          "Archive inactive templates and restore them when needed.",
        ],
      },
      {
        id: "delete",
        title: "Delete carefully",
        warning:
          "Folder deletion can move templates back to the default location or remove them, depending on the selected option. Review the confirmation dialog and retain records required by policy.",
      },
    ],
    slug: "create-folders",
    title: "Organize templates and folders",
  },
  {
    audience: "Workspace administrators",
    category: "Access",
    description:
      "Invite users, import member lists, assign roles, restore access, and remove users safely.",
    estimatedTime: "10 minutes",
    outcomes: ["Workspace access aligned with current staff responsibilities"],
    prerequisites: ["Administrator access"],
    related: [
      { href: "/resources/manage-teams", label: "Manage teams" },
      {
        href: "/resources/configure-security-preferences",
        label: "Configure security preferences",
      },
    ],
    sections: [
      {
        id: "invite",
        title: "Invite individual users",
        paragraphs: [
          "Open Settings > Users, add the user email and role, and assign a team when appropriate. Use administrator access only for people who manage workspace-wide settings.",
        ],
      },
      {
        id: "import",
        title: "Import users in bulk",
        bullets: [
          "Paste an email list for simple member invitations.",
          "Use CSV or XLSX with email, first_name, last_name, role, and team headers.",
          "Download the sample CSV and preview parsed rows before importing.",
          "Review created, restored, skipped, and failed counts after import.",
        ],
      },
      {
        id: "lifecycle",
        title: "Manage the user lifecycle",
        bullets: [
          "Update roles when responsibilities change.",
          "Deactivate or remove access promptly when a user leaves.",
          "Restore a previously removed user instead of creating duplicate identity records.",
          "Review team membership and API access after every role change.",
        ],
      },
    ],
    slug: "manage-users",
    title: "Manage workspace users",
  },
  {
    audience: "Workspace administrators",
    category: "Access",
    description:
      "Create team contexts, assign members and roles, and keep templates and API access scoped.",
    estimatedTime: "10 minutes",
    outcomes: ["Teams with named owners and appropriate member access"],
    prerequisites: ["Administrator access", "Existing or invited users"],
    related: [
      { href: "/resources/manage-users", label: "Manage users" },
      { href: "/resources/manage-api-keys", label: "Manage API keys" },
    ],
    sections: [
      {
        id: "create",
        title: "Create a team",
        paragraphs: [
          "Open Settings > Teams, provide a name that reflects the operating group, and add a short description so administrators understand its purpose.",
        ],
      },
      {
        id: "members",
        title: "Assign members and roles",
        bullets: [
          "Add existing workspace users to the team.",
          "Use manager for people who administer the team context.",
          "Use member for routine template and submission work.",
          "Remove stale membership when a user changes responsibilities.",
        ],
      },
      {
        id: "context",
        title: "Work in team context",
        paragraphs: [
          "Use View or Impersonate to enter the selected team context. Confirm the active context before creating templates, submissions, or scoped API keys.",
        ],
        warning:
          "Team context changes which records and credentials an action belongs to. Display and verify the active team before making production changes.",
      },
    ],
    slug: "manage-teams",
    title: "Manage teams",
  },
  {
    audience: "Workspace administrators and operations leads",
    category: "Communication",
    description:
      "Set reminders, completion emails, BCC recipients, and delivery behavior without creating notification noise.",
    estimatedTime: "10 minutes",
    outcomes: ["A documented notification policy tested against the mail provider"],
    prerequisites: ["Administrator access", "Working email delivery"],
    related: [
      {
        href: "/resources/personalize-branding-and-email",
        label: "Personalize email content",
      },
      {
        href: "/resources/connect-integrations",
        label: "Connect email integrations",
      },
    ],
    sections: [
      {
        id: "reminders",
        title: "Configure reminders",
        paragraphs: [
          "Choose a reminder interval that matches the urgency and expected signing window. Avoid aggressive reminders for low-urgency agreements.",
        ],
      },
      {
        id: "copies",
        title: "Configure completion copies",
        bullets: [
          "Choose whether workspace users receive completion emails.",
          "Add BCC recipients only for approved operational mailboxes.",
          "Confirm whether recipients can request a copy from the completed page.",
          "Review download-link expiration and authentication together with email content.",
        ],
      },
      {
        id: "test",
        title: "Test the notification path",
        steps: [
          {
            title: "Send a provider test",
            body: "Use the mail test action and verify inbox placement.",
          },
          {
            title: "Complete a test submission",
            body: "Observe invitation, reminder, completion, and copy behavior.",
          },
          {
            title: "Inspect events",
            body: "Confirm queued and provider delivery events appear in submission activity.",
          },
        ],
      },
    ],
    slug: "configure-notifications",
    title: "Configure notifications and reminders",
  },
  {
    audience: "Security and compliance administrators",
    category: "Security",
    description:
      "Require stronger authentication, signer intent, protected downloads, and complete evidence records.",
    estimatedTime: "12 minutes",
    outcomes: ["A workspace security policy reflected in Signa preferences"],
    prerequisites: ["Workspace owner or administrator access"],
    related: [
      { href: "/compliance", label: "Compliance and trust" },
      {
        href: "/resources/configure-signing-certificates",
        label: "Signing certificates",
      },
    ],
    sections: [
      {
        id: "authentication",
        title: "Set authentication controls",
        bullets: [
          "Force authenticator-app MFA for workspace access where required.",
          "Use email or phone verification in public and sensitive signing flows.",
          "Require download authentication for completed documents.",
          "Expire download links instead of publishing permanent file URLs.",
        ],
      },
      {
        id: "intent",
        title: "Record signer intent",
        bullets: [
          "Require a signing reason for regulated workflows.",
          "Add a visible signer ID where policy requires it.",
          "Decide whether typed signatures and saved-signature reuse are acceptable.",
          "Allow decline, delegation, or resubmission only when the business process supports them.",
        ],
      },
      {
        id: "evidence",
        title: "Retain complete evidence",
        paragraphs: [
          "Enable combined completed documents and audit log when a single evidence file simplifies retention. Run a full test after policy changes because stricter controls alter both sender and signer workflows.",
        ],
      },
    ],
    slug: "configure-security-preferences",
    title: "Configure security preferences",
  },
  {
    audience: "Security administrators",
    category: "Trust",
    description:
      "Upload signing certificates and trust roots, select a default certificate, and configure RFC 3161 timestamps.",
    estimatedTime: "15 minutes",
    outcomes: ["A tested certificate and trust configuration"],
    prerequisites: [
      "Authorized P12/PFX, PEM, or CRT material",
      "Private-key password where applicable",
      "Timestamp server details when timestamps are required",
    ],
    related: [
      { href: "/guides/verify-signed-pdfs", label: "Verify signed PDFs" },
      { href: "/compliance", label: "Compliance and trust" },
    ],
    sections: [
      {
        id: "certificates",
        title: "Configure signing certificates",
        bullets: [
          "Upload the certificate and private key using the format expected by the settings form.",
          "Name certificates so operators can identify owner, environment, and expiry.",
          "Select the intended default certificate.",
          "Protect certificate files and passwords outside Signa according to your key-management policy.",
        ],
      },
      {
        id: "timestamp",
        title: "Configure timestamps",
        paragraphs: [
          "Add the RFC 3161 timestamp server URL and credentials if required. Complete a test document and verify that the timestamp token appears in the result.",
        ],
      },
      {
        id: "trust",
        title: "Manage trust roots",
        paragraphs: [
          "Upload approved root certificates used to classify external signatures as trusted. Remove roots only after evaluating existing verification and retention requirements.",
        ],
        warning:
          "Uploading a root certificate changes trust classification; it does not prove that every document signed by a chained certificate is authorized for your business process.",
      },
    ],
    slug: "configure-signing-certificates",
    title: "Configure signing certificates and trust",
  },
  {
    audience: "Integration administrators",
    category: "Integrations",
    description:
      "Connect Gmail, enable Google Drive import, and validate SMTP, SMS, and OAuth configuration.",
    estimatedTime: "15 minutes",
    outcomes: ["A tested provider connection with a known fallback path"],
    prerequisites: ["Administrator access", "Provider credentials or OAuth app"],
    related: [
      {
        href: "/resources/configure-notifications",
        label: "Configure notifications",
      },
      { href: "/docs/webhooks", label: "Configure webhooks" },
    ],
    sections: [
      {
        id: "google-sign-in",
        title: "Configure Google sign-in",
        paragraphs: [
          "Google sign-in and Gmail sending are separate connections. Sign-in uses OpenID Connect to authenticate a user; Gmail sending requires approval to send email from a connected mailbox.",
        ],
        steps: [
          { title: "Create the OAuth client", body: "Create or select a Web application OAuth client in Google Cloud and configure the consent screen for your users." },
          { title: "Register the callback", body: "Register the exact callback URL: http://localhost:3000/auth/oauth/google/callback for local development, or your HTTPS application origin followed by /auth/oauth/google/callback in production." },
          { title: "Configure the backend", body: "Set GOOGLE_AUTH_CLIENT_ID, GOOGLE_AUTH_CLIENT_SECRET, and GOOGLE_AUTH_REDIRECT_URI in the backend environment. Keep the client secret on the server and restart the backend after changing configuration." },
          { title: "Test sign-in", body: "Choose Sign in with Google, complete Google's consent flow, and verify that you return to Templates in the correct workspace. Test an existing login and a new identity according to your registration policy." },
        ],
      },
      {
        id: "email",
        title: "Connect an email provider",
        paragraphs: [
          "Settings > Integrations supports Gmail account connections when the matching OAuth client and redirect URI are configured on the backend.",
        ],
        bullets: [
          "Confirm the redirect URI exactly matches the provider application.",
          "Connect the approved mailbox and send a test email.",
          "Disconnect stale provider accounts when ownership changes.",
          "Keep SMTP configured as the deployment-level delivery path when required.",
        ],
      },
      {
        id: "drive",
        title: "Enable Google Drive import",
        paragraphs: [
          "Configure the Google Drive Picker client and API key on the deployment, then test document selection from the Create dialog.",
        ],
      },
      {
        id: "sms",
        title: "Enable SMS and phone verification",
        paragraphs: [
          "Configure Twilio messaging for delivery and Twilio Verify for one-time phone verification. Test international phone formatting and provider callbacks before enabling phone-only production flows.",
        ],
      },
    ],
    slug: "connect-integrations",
    title: "Connect integrations",
  },
  {
    audience: "Developers and workspace administrators",
    category: "API",
    description:
      "Reveal, rotate, and scope API keys without exposing credentials to browsers or client applications.",
    estimatedTime: "8 minutes",
    outcomes: ["A least-privileged API key stored in a server-side secret manager"],
    prerequisites: ["Permission to manage API credentials"],
    related: [
      { href: "/docs/api#authentication", label: "API authentication" },
      {
        href: "/guides/send-documents-for-signature-via-api",
        label: "Send with the API",
      },
    ],
    sections: [
      {
        id: "create",
        title: "Obtain and store the key",
        paragraphs: [
          "Open Settings > API and reveal the key only in a private environment. Store it in a server-side secret manager or deployment environment variable.",
        ],
        warning:
          "Never place an API key in browser JavaScript, a mobile binary, screenshots, support messages, or source control.",
      },
      {
        id: "scope",
        title: "Set permissions",
        bullets: [
          "Grant only the resource permissions the integration uses.",
          "Use the correct workspace or team context.",
          "Keep test and production credentials separate.",
          "Document the owning service and rotation contact.",
        ],
      },
      {
        id: "rotate",
        title: "Rotate safely",
        steps: [
          {
            title: "Prepare the consuming service",
            body: "Make sure the service can accept the replacement secret without a code release where possible.",
          },
          {
            title: "Rotate in Signa",
            body: "Generate the replacement and update the secret store immediately.",
          },
          {
            title: "Test a low-risk request",
            body: "Confirm authentication and permissions before normal traffic resumes.",
          },
        ],
      },
    ],
    slug: "manage-api-keys",
    title: "Manage API keys",
  },
  {
    audience: "Self-hosted operators",
    category: "Storage",
    description:
      "Understand local and S3-compatible storage for source files, previews, attachments, completed PDFs, and audit evidence.",
    estimatedTime: "12 minutes",
    outcomes: ["A private, durable storage configuration with a tested backup path"],
    prerequisites: ["Deployment access", "A private bucket for production use"],
    related: [
      {
        href: "/resources/deploy-signa-on-premise",
        label: "Deploy Signa on-premise",
      },
      { href: "/guides/troubleshooting", label: "Troubleshooting" },
    ],
    sections: [
      {
        id: "model",
        title: "Know what is stored",
        bullets: [
          "Original PDF, DOCX, and HTML uploads",
          "Rendered page previews",
          "Signer-provided files, images, and signatures",
          "Completed documents and audit logs",
          "Temporary processing and verification artifacts",
        ],
      },
      {
        id: "s3",
        title: "Configure private object storage",
        paragraphs: [
          "Set S3_ATTACHMENTS_BUCKET to enable S3 storage. Provide AWS_REGION and credentials when the runtime does not use an instance or workload role. Set S3_ENDPOINT only for a compatible non-AWS provider.",
        ],
        note:
          "Prefer workload identity or instance roles over long-lived access keys when the hosting platform supports them.",
      },
      {
        id: "validate",
        title: "Validate storage before launch",
        bullets: [
          "Upload and render a multi-page document.",
          "Complete a request with a file or image attachment.",
          "Download the completed PDF after restarting the application.",
          "Test backup and restore, not only backup creation.",
          "Confirm bucket objects are private and served through authorized Signa routes.",
        ],
      },
    ],
    slug: "manage-attachments-and-storage",
    title: "Manage attachments and storage",
  },
  {
    audience: "Self-hosted operators",
    category: "Deployment",
    description:
      "Install Signa with Docker Compose, create the first owner, and configure durable storage, mail delivery, HTTPS, backups, and upgrades.",
    estimatedTime: "15 minutes",
    outcomes: [
      "A running Signa installation on port 3000",
      "A persistent owner account and document store",
      "A deployment you can verify, back up, and upgrade",
    ],
    prerequisites: [
      "A Linux server with Docker Engine and the Docker Compose plugin",
      "Access to the Signa source repository",
      "Port 3000 available for local evaluation, or a domain and HTTPS reverse proxy for production",
    ],
    related: [
      {
        href: "https://docs.docker.com/engine/install/",
        label: "Install Docker Engine",
      },
      {
        href: "/resources/manage-attachments-and-storage",
        label: "Attachments and storage",
      },
      {
        href: "/resources/connect-integrations",
        label: "Connect integrations",
      },
      { href: "/guides/troubleshooting", label: "Troubleshooting" },
    ],
    sections: [
      {
        id: "compose-install",
        title: "Install with Docker Compose",
        paragraphs: [
          "Clone Signa, create the small environment file below, and start the stack. This default installation keeps SQLite, uploaded files, completed documents, the generated application secret, and private Redis data in the signa-data Docker volume.",
        ],
        code: {
          language: "bash",
          title: "Terminal",
          value:
            "git clone https://github.com/codeignite-labs/signa.git\ncd signa\nprintf 'APP_URL=http://localhost:3000\\nREGISTRATION_MODE=initial_only\\n' > .env\ndocker compose up -d --build",
        },
        note:
          "Do not run docker compose down -v unless you intend to permanently delete the named data volume.",
      },
      {
        id: "verify-installation",
        title: "Verify the installation",
        paragraphs: [
          "Wait for the image build and application startup to finish, then inspect the container and call the health endpoint. The health response should report a successful status before you create an account.",
        ],
        code: {
          language: "bash",
          title: "Health checks",
          value:
            "docker compose ps\ncurl -fsS http://localhost:3000/api/health\ndocker compose logs --tail=100 signa",
        },
        bullets: [
          "Application: http://localhost:3000",
          "API documentation: http://localhost:3000/api/docs",
          "Health endpoint: http://localhost:3000/api/health",
        ],
      },
      {
        id: "create-owner",
        title: "Create the first owner",
        steps: [
          {
            title: "Open registration",
            body: "Visit http://localhost:3000/auth/register, enter the owner details, and create the first account.",
          },
          {
            title: "Sign in to the workspace",
            body: "After registration, Signa opens the product workspace. Confirm that Templates, Submissions, and Settings are available.",
          },
          {
            title: "Keep registration restricted",
            body: "REGISTRATION_MODE=initial_only automatically blocks later self-service registrations after the first user exists. Add other users through workspace invitations.",
          },
        ],
      },
      {
        id: "docker-run",
        title: "Run without Docker Compose",
        paragraphs: [
          "If you prefer a single Docker command, build the same image from the repository and mount /data as a named volume.",
        ],
        code: {
          language: "bash",
          title: "Docker",
          value:
            "docker build -t signa:local .\ndocker run -d \\\n  --name signa \\\n  --restart unless-stopped \\\n  -p 3000:3000 \\\n  -e APP_URL=http://localhost:3000 \\\n  -e REGISTRATION_MODE=initial_only \\\n  -v signa-data:/data \\\n  signa:local",
        },
      },
      {
        id: "public-url",
        title: "Set the production URL",
        paragraphs: [
          "Point your domain to the server, terminate HTTPS with a reverse proxy or load balancer, and set APP_URL to the public HTTPS origin. Signa derives frontend, API, signing, storage, and email links from this one value.",
        ],
        code: {
          language: "dotenv",
          title: ".env",
          value:
            "APP_URL=https://sign.example.com\nREGISTRATION_MODE=initial_only",
        },
        note:
          "After changing .env, apply it with docker compose up -d. Keep port 3000 behind the HTTPS proxy instead of exposing it directly to the public internet.",
      },
      {
        id: "database-storage",
        title: "Choose database and document storage",
        paragraphs: [
          "The default SQLite database and local document storage are appropriate for a single-node installation when the signa-data volume is backed up. Set DATABASE_URL for PostgreSQL and S3_ATTACHMENTS_BUCKET for private object storage when your recovery or scaling requirements call for external persistence.",
        ],
        code: {
          language: "dotenv",
          title: "Optional production persistence",
          value:
            "DATABASE_URL=postgresql://signa:replace-me@postgres.example.com:5432/signa\nDATABASE_SSL=true\n\nS3_ATTACHMENTS_BUCKET=signa-documents\nAWS_REGION=eu-west-1",
        },
        note:
          "On AWS, prefer an instance or workload role. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY only when the runtime cannot receive credentials from its platform. Set S3_ENDPOINT only for a non-AWS S3-compatible provider.",
      },
      {
        id: "email",
        title: "Enable email delivery",
        paragraphs: [
          "SMTP_ADDRESS enables email. Add the provider settings to .env, recreate the container, then send a test signature request to an address you control.",
        ],
        code: {
          language: "dotenv",
          title: "SMTP settings",
          value:
            "SMTP_ADDRESS=smtp.example.com\nSMTP_PORT=587\nSMTP_USERNAME=signa-smtp-user\nSMTP_PASSWORD=replace-me\nSMTP_AUTHENTICATION=plain\nSMTP_FROM=Signa <signing@example.com>\nSMTP_REPLY_TO=support@example.com\nSMTP_ENABLE_STARTTLS=true\nSMTP_SSL_VERIFY=true",
        },
        warning:
          "Do not disable certificate verification in production. If delivery fails, inspect the submission activity and docker compose logs before retrying.",
      },
      {
        id: "apply-configuration",
        title: "Apply and test the production configuration",
        code: {
          language: "bash",
          title: "Restart and verify",
          value:
            "docker compose config\ndocker compose up -d --build\ndocker compose ps\ncurl -fsS https://sign.example.com/api/health",
        },
        bullets: [
          "Create a template and wait for every page preview to render.",
          "Send a request and confirm the invitation email arrives.",
          "Complete the request and download the completed PDF.",
          "Restart the container and confirm the template and completed document still exist.",
        ],
      },
      {
        id: "backup-upgrade",
        title: "Back up and upgrade",
        paragraphs: [
          "For the default single-node installation, archive /data before an upgrade. External PostgreSQL databases and S3 buckets must be backed up with their provider-native tools as part of the same recovery point.",
        ],
        code: {
          language: "bash",
          title: "Backup and upgrade",
          value:
            "docker compose exec -T signa tar -C /data -czf - . > signa-data-$(date +%F-%H%M%S).tar.gz\n\ngit pull --ff-only\ndocker compose up -d --build\ndocker compose ps",
        },
        note:
          "Test restoration on a separate server. A backup is not complete until the database and document objects can be restored together.",
      },
      {
        id: "production-checks",
        title: "Production checklist",
        bullets: [
          "The public APP_URL uses HTTPS and resolves to the deployment.",
          "The health endpoint returns success through the public proxy.",
          "The first owner exists and public registration is closed.",
          "Database records and document objects share a tested backup schedule.",
          "Pin a Git release or commit and test upgrades in a staging environment.",
          "Monitor health, storage failures, queue failures, and email delivery errors.",
          "Keep secrets out of Compose files and source control.",
        ],
      },
    ],
    slug: "deploy-signa-on-premise",
    title: "Deploy Signa on-premise",
  },
];
