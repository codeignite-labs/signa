import type { LucideIcon } from "lucide-react";
import {
  BadgeCheckIcon,
  BookOpenIcon,
  BracesIcon,
  Building2Icon,
  CheckCircle2Icon,
  Code2Icon,
  FileCheck2Icon,
  FileSignatureIcon,
  FolderKanbanIcon,
  Globe2Icon,
  KeyRoundIcon,
  LockKeyholeIcon,
  MailCheckIcon,
  MessageSquareTextIcon,
  MonitorSmartphoneIcon,
  PenToolIcon,
  PlugZapIcon,
  RadioTowerIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UploadCloudIcon,
  UsersRoundIcon,
  WebhookIcon,
} from "lucide-react";
import {
  guideArticles,
  resourceArticles,
  type DocsArticle,
} from "@/lib/docs/articles";

export {
  guideArticles,
  resourceArticles,
  type DocsArticle,
} from "@/lib/docs/articles";

export type DocsCard = {
  description: string;
  href: string;
  icon: LucideIcon;
  label: string;
  title: string;
};

export type DocsSection = {
  description: string;
  icon: LucideIcon;
  items: string[];
  title: string;
};

export const docsHubCards: DocsCard[] = [
  {
    description:
      "Set up workspaces, upload documents, prepare templates, and send your first signing request.",
    href: "/guides",
    icon: BookOpenIcon,
    label: "Start here",
    title: "User guides and workflows",
  },
  {
    description:
      "DocuSeal-compatible API shape for templates, submissions, submitters, attachments, webhooks, and tools.",
    href: "/docs/api",
    icon: BracesIcon,
    label: "REST",
    title: "API and webhooks",
  },
  {
    description:
      "Embed signing and builder flows in React, React Native, and plain browser applications.",
    href: "/docs/embedding",
    icon: Code2Icon,
    label: "SDK",
    title: "Embedded signing",
  },
  {
    description:
      "Understand audit logs, signing certificates, PAdES signatures, timestamps, and verification output.",
    href: "/compliance",
    icon: ShieldCheckIcon,
    label: "Trust",
    title: "Compliance and verification",
  },
  {
    description:
      "Operate Signa with Docker, SQLite/PostgreSQL, S3-compatible storage, Redis queues, mail, SMS, and OAuth.",
    href: "/resources/deploy-signa-on-premise",
    icon: Building2Icon,
    label: "On-prem",
    title: "Deployment resources",
  },
  {
    description:
      "Advanced and qualified electronic signing options, identity verification, and policy considerations.",
    href: "/qualified-electronic-signature",
    icon: BadgeCheckIcon,
    label: "QES",
    title: "Qualified signatures",
  },
];

export const apiReferenceCards: DocsCard[] = [
  {
    description:
      "Create, update, archive, clone, folder, and inspect templates with document previews and field schema.",
    href: "/docs/api#templates",
    icon: FileSignatureIcon,
    label: "Templates",
    title: "Template API",
  },
  {
    description:
      "Create signature requests from templates, PDF, DOCX, or HTML and control recipients, ordering, and prefill values.",
    href: "/docs/api#submissions",
    icon: MailCheckIcon,
    label: "Submissions",
    title: "Submission API",
  },
  {
    description:
      "Upload files, images, signatures, and API-supplied attachments for field values and document creation.",
    href: "/docs/api#attachments",
    icon: UploadCloudIcon,
    label: "Files",
    title: "Attachments",
  },
  {
    description:
      "Receive signed webhook events with HMAC verification, retry attempts, and delivery logs.",
    href: "/docs/webhooks",
    icon: WebhookIcon,
    label: "Events",
    title: "Webhooks",
  },
  {
    description:
      "Merge PDFs and verify Signa/third-party signed PDFs with PAdES, timestamp, DSS/VRI, and trust-chain metadata.",
    href: "/docs/api#tools",
    icon: FileCheck2Icon,
    label: "Tools",
    title: "Tools API",
  },
  {
    description:
      "Use per-user API keys with scoped permissions and the same account/team authorization model as the web app.",
    href: "/resources/manage-api-keys",
    icon: KeyRoundIcon,
    label: "Auth",
    title: "API keys",
  },
];

export const legacyGuideArticles: Array<{
  category: string;
  description: string;
  image?: string;
  slug: string;
  steps: string[];
  title: string;
}> = [
  {
    category: "Getting started",
    description:
      "Create a workspace, upload the first document, place fields, send recipients, and verify the signed PDF.",
    image: "guide-quick-start.png",
    slug: "quick-start",
    title: "Quick start",
    steps: [
      "Register the initial owner account or accept an administrator invitation.",
      "Open Templates, upload a PDF/DOCX/HTML document, and confirm preview rendering.",
      "Add signer roles and place fields for each role on the document.",
      "Send recipients from the template detail page or use Sign yourself for a self-sign flow.",
      "Download the completed PDF and verify it in Settings > E-Signature.",
    ],
  },
  {
    category: "Sending documents",
    description:
      "Send one or many recipients from the web UI with email, phone, detailed recipient records, and CSV/XLSX upload.",
    image: "guide-send-recipients.png",
    slug: "send-documents-to-recipients",
    title: "Send documents to recipients",
    steps: [
      "Open the template detail page and choose Send to recipients.",
      "Use via Email for comma-separated emails, via Phone for SMS links, Detailed for name/email/phone, or Upload List for bulk import.",
      "Choose preserved signing order when roles must sign sequentially.",
      "Customize the email copy with the Signa editor and variables.",
      "Submit the request and track mail/SMS delivery from submission activity.",
    ],
  },
  {
    category: "API",
    description:
      "Create a submission programmatically, optionally auto-sign the owner role, and route downstream signers.",
    image: "guide-api-submission.png",
    slug: "send-documents-for-signature-via-api",
    title: "Send documents for signature via API",
    steps: [
      "Create or reuse a template and capture its template_id.",
      "POST /api/submissions with template_id, submitters, send_email/send_sms, and submitters_order.",
      "Use external_id and metadata to map the Signa submission to your application record.",
      "Enable owner auto-sign at account, template, or submission level when the business role should complete first.",
      "Listen for submission.completed or form.completed webhooks to continue your workflow.",
    ],
  },
  {
    category: "API",
    description:
      "Prefill text, date, checkbox, radio, multiple, select, file, image, and signature values before recipients open the form.",
    image: "guide-prefill-values.png",
    slug: "pre-fill-pdf-document-form-fields-with-api",
    title: "Pre-fill document fields with API",
    steps: [
      "Use field names that match the template schema or embedded text tags.",
      "Provide values in create/update submission payloads using Signa field value normalization.",
      "Upload attachment-backed values first or provide supported base64/remote URL inputs.",
      "Use readonly_fields when the recipient should see but not edit a value.",
      "Verify values on the signing page before sending production requests.",
    ],
  },
  {
    category: "Template builder",
    description:
      "Use {{...}} tags in PDF/DOCX documents to auto-detect fields and reduce manual builder work.",
    image: "guide-field-tags.png",
    slug: "use-embedded-text-field-tags",
    title: "Use embedded text field tags",
    steps: [
      "Place tags such as {{Signature;role=Client;type=signature}} in the source document.",
      "Upload the document and run field detection from the builder.",
      "Review detected geometry and role assignment on the right sidebar.",
      "Remove or keep detected fields using the detection prompt.",
      "Save the template so detected fields become part of the signing schema.",
    ],
  },
  {
    category: "Dynamic documents",
    description:
      "Create personalized DOCX templates with [[variables]] and fillable {{fields}}.",
    image: "guide-dynamic-docx.png",
    slug: "create-dynamic-docx-templates",
    title: "Create dynamic DOCX templates",
    steps: [
      "Add [[variable_name]] placeholders where backend values should be merged.",
      "Add {{field tags}} where recipients must sign or provide input.",
      "Upload the DOCX through the template create or API flow.",
      "Create submissions with variables and submitters.",
      "Review generated preview pages before sending production traffic.",
    ],
  },
  {
    category: "Verification",
    description:
      "Configure signing certificates, timestamp servers, trust roots, and PDF verification output.",
    image: "guide-signing-certificates.png",
    slug: "verify-signed-pdfs",
    title: "Verify signed PDFs",
    steps: [
      "Open Settings > E-Signature and upload a P12/PFX, PEM, or CRT certificate where required.",
      "Optionally configure a timestamp server URL for RFC3161 timestamp tokens.",
      "Complete a document and download the signed PDF.",
      "Upload it to the PDF verification panel.",
      "Check signature validity, signer, signing time, trust chain, timestamp, and LTV status.",
    ],
  },
  {
    category: "Deployment",
    description:
      "Run Signa on-prem with Docker, Redis, SQLite/PostgreSQL, S3 storage, mail, OAuth, and registration bootstrap.",
    image: "guide-docker-deploy.png",
    slug: "deploy-signa-on-premise",
    title: "Deploy Signa on-premise",
    steps: [
      "Clone the Signa repository and create .env with APP_URL and REGISTRATION_MODE=initial_only.",
      "Run docker compose up -d --build and verify /api/health.",
      "Create the first owner at /auth/register; later public registrations close automatically.",
      "Keep the signa-data volume backed up, or configure PostgreSQL and private S3 storage.",
      "Set SMTP_ADDRESS and related SMTP values, then complete a real test request.",
    ],
  },
  {
    category: "Integration",
    description:
      "Embed the hosted signing form in React with pinned CDN scripts, callbacks, and production host settings.",
    image: "guide-react-embed.png",
    slug: "embed-signing-in-react",
    title: "Embed signing in React",
    steps: [
      "Install @signajs/react and import SignaForm from the package.",
      "Create a submission through the API or UI and pass the returned /s/{submitterSlug} URL to src.",
      "Pass host when the signing route belongs to a self-hosted Signa instance.",
      "Use onLoad, onComplete, and onDecline to update your app state after hosted signing events.",
      "Pin scriptUrl to an exact jsDelivr/npm version or serve /js/form.js from your own Signa deployment.",
    ],
  },
  {
    category: "Integration",
    description:
      "Embed the hosted signing form in Expo or React Native with react-native-webview.",
    image: "guide-react-native-embed.png",
    slug: "embed-signing-in-react-native",
    title: "Embed signing in React Native",
    steps: [
      "Install @signajs/react-native and react-native-webview.",
      "Use a real network-reachable Signa host; Android emulators cannot reach localhost on your laptop through localhost.",
      "Pass either src or host plus slug/token to SignaSigningView.",
      "Handle onLoad, onComplete, onDecline, and onError to navigate after signing.",
      "Keep document download UX outside the WebView when your mobile app needs native file handling.",
    ],
  },
  {
    category: "Troubleshooting",
    description:
      "Resolve common upload, preview, signing, verification, webhook, package, and deployment issues.",
    image: "guide-troubleshooting.png",
    slug: "troubleshooting",
    title: "Troubleshooting",
    steps: [
      "For 401 errors, create or rotate the API key and send it as X-Auth-Token.",
      "For blank previews, confirm the file is not password protected and check whether it is XFA or AcroForm.",
      "For embed refused-to-connect errors, use a Signa host that allows iframe/WebView loading and matches the public signing URL.",
      "For queued emails/SMS, inspect submission activity and provider delivery logs before retrying.",
      "For verification warnings, compare trusted/external certificate status, timestamp presence, and LTV evidence status.",
    ],
  },
];

export const legacyResourceArticles: Array<{
  category: string;
  description: string;
  image?: string;
  slug: string;
  steps: string[];
  title: string;
}> = [
  {
    category: "Getting started",
    description: "The minimum path from account creation to a completed PDF.",
    image: "resource-quick-start.png",
    slug: "quick-start",
    title: "Quick start",
    steps: [
      "Create the first account or sign in with an invited account.",
      "Upload your document from Templates.",
      "Place required fields and save.",
      "Send recipients or sign yourself.",
      "Track completion from the submission detail page.",
    ],
  },
  {
    category: "Branding",
    description:
      "Customize logo, signing messages, completed-form copy, confetti, and email templates.",
    image: "resource-branding.png",
    slug: "personalize-branding-and-email",
    title: "Personalize branding and email",
    steps: [
      "Open Settings > Personalization to upload a logo and configure completed-form messaging.",
      "Open Settings > Notifications to edit request, copy, and completed email templates.",
      "Use variables such as {template.name}, {account.name}, and signer details.",
      "Preview messages in Mailpit or your SMTP provider before production.",
    ],
  },
  {
    category: "Workflow",
    description:
      "Organize templates into folders, rename folders, move templates, and archive inactive items.",
    image: "resource-folders.png",
    slug: "create-folders",
    title: "Create folders",
    steps: [
      "Use New Folder from Templates.",
      "Move templates using the card action menu.",
      "Rename or delete folders from folder management actions.",
      "Choose whether deleting a folder returns templates to Default or removes the templates as well.",
    ],
  },
  {
    category: "Teams",
    description:
      "Create team accounts, assign members, impersonate team context, and scope API keys.",
    image: "resource-teams.png",
    slug: "manage-teams",
    title: "Manage teams",
    steps: [
      "Open Settings > Teams and create a team account.",
      "Add existing members or invite users from Settings > Users.",
      "Assign team roles such as manager or member.",
      "Use View or Impersonate to work in the selected team context.",
      "Generate team-scoped API keys where needed.",
    ],
  },
  {
    category: "Security",
    description:
      "Require MFA, signing reasons, download authentication, and signed-document audit log combination.",
    image: "resource-security-preferences.png",
    slug: "configure-security-preferences",
    title: "Configure security preferences",
    steps: [
      "Open Settings > Account.",
      "Enable Force 2FA with Authenticator App for stronger signer/user authentication.",
      "Enable signing ID, signing reason, download-link expiration, and download authentication as required.",
      "Enable combined completed documents and audit log for a single recordkeeping PDF.",
    ],
  },
  {
    category: "Integrations",
    description:
      "Connect Gmail, Google Drive Picker, webhooks, S3, mail, SMS, and OAuth.",
    image: "resource-integrations.png",
    slug: "connect-integrations",
    title: "Connect integrations",
    steps: [
      "Use Settings > Integrations for Gmail account connections.",
      "Configure Google Drive Picker env vars for template import.",
      "Add webhook URLs under Settings > Webhooks.",
      "Configure S3 and SMTP from deployment env vars.",
      "Add Twilio Verify or messaging env vars for phone delivery and verification.",
    ],
  },
  {
    category: "Storage",
    description:
      "Understand how Signa stores uploaded documents, generated previews, completed PDFs, audit logs, and user-provided attachments.",
    image: "resource-attachments-storage.png",
    slug: "manage-attachments-and-storage",
    title: "Manage attachments and storage",
    steps: [
      "Use local storage for development and single-node evaluation when S3-compatible storage is not configured.",
      "Configure S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY for production blob storage.",
      "Keep original uploads, rendered previews, completed PDFs, audit logs, and API attachments in the same storage service abstraction.",
      "Use signed or proxied download routes from Signa instead of exposing private bucket objects directly.",
      "Verify upload limits, MIME type handling, and backup retention before moving production document traffic.",
    ],
  },
];

export const complianceSections: DocsSection[] = [
  {
    description:
      "Signa records who signed, when they signed, what device/session was used, and the ordered activity trail for the document.",
    icon: ScrollTextIcon,
    title: "Audit trail",
    items: [
      "Submission, submitter, template, mail, SMS, webhook, and signing events.",
      "Device, user agent, IP, and optional location metadata captured during signing.",
      "Combined completed document and audit log setting for record retention.",
    ],
  },
  {
    description:
      "Completed PDFs can include visual signer ID stamps plus cryptographic PAdES signatures.",
    icon: FileCheck2Icon,
    title: "Document integrity",
    items: [
      "PAdES-compatible ETSI.CAdES.detached signature subfilter.",
      "RFC3161 timestamp support when a timestamp server is configured.",
      "DSS/VRI revocation evidence collection and verification status where certificate endpoints provide OCSP/CRL data.",
    ],
  },
  {
    description:
      "Signa supports default signing certificates and uploaded customer certificates/trust roots.",
    icon: LockKeyholeIcon,
    title: "Certificate trust",
    items: [
      "P12/PFX, PEM, and CRT certificate handling.",
      "Trust-chain display for Signa and external customer certificates.",
      "Trusted/external/no-signature verification outcomes.",
    ],
  },
  {
    description:
      "Controls are available for regulated teams that need stronger signer intent and authentication.",
    icon: CheckCircle2Icon,
    title: "Policy controls",
    items: [
      "Authenticator-app MFA, signing reason, signer ID, download auth, expirable file links.",
      "Typed-signature control and saved-signature reuse policy.",
      "Test mode separation for sandbox workflows.",
    ],
  },
];

export const qesSections: DocsSection[] = [
  {
    description:
      "Simple electronic signatures are available in the default flow for general agreements.",
    icon: PenToolIcon,
    title: "SES",
    items: [
      "Draw, type, upload, or reuse saved signatures.",
      "Signer intent recorded through field completion and final consent.",
      "Audit logs and completed PDF verification support.",
    ],
  },
  {
    description:
      "Advanced electronic signing can be layered with stricter identity and certificate requirements.",
    icon: ShieldCheckIcon,
    title: "AES",
    items: [
      "Require MFA and signing reason for sensitive workflows.",
      "Use customer certificates and trust roots.",
      "Capture detailed audit, device, and event metadata.",
    ],
  },
  {
    description:
      "Qualified electronic signing requires an external qualified trust service provider and jurisdiction-specific identity proofing.",
    icon: BadgeCheckIcon,
    title: "QES",
    items: [
      "Planned provider integration point for country/provider selection.",
      "Keep QES policy separate from default SES workflows.",
      "Record external provider evidence in submission activity and verification results.",
    ],
  },
];

export const docsResources = [
  { href: "/resources/quick-start", label: "Quick start", icon: SparklesIcon },
  {
    href: "/resources/personalize-branding-and-email",
    label: "Branding & communication",
    icon: MessageSquareTextIcon,
  },
  {
    href: "/guides/send-documents-to-recipients",
    label: "Sending documents",
    icon: MailCheckIcon,
  },
  {
    href: "/resources/create-folders",
    label: "Templates & folders",
    icon: FolderKanbanIcon,
  },
  { href: "/resources/manage-teams", label: "Teams", icon: UsersRoundIcon },
  {
    href: "/resources/connect-integrations",
    label: "Integrations",
    icon: PlugZapIcon,
  },
  {
    href: "/resources/manage-attachments-and-storage",
    label: "Attachments & storage",
    icon: UploadCloudIcon,
  },
  {
    href: "/guides/verify-signed-pdfs",
    label: "PDF verification",
    icon: FileCheck2Icon,
  },
  {
    href: "/docs/embedding",
    label: "Embedding",
    icon: MonitorSmartphoneIcon,
  },
  {
    href: "/docs/webhooks",
    label: "Webhooks",
    icon: RadioTowerIcon,
  },
  {
    href: "/qualified-electronic-signature",
    label: "Qualified signatures",
    icon: Globe2Icon,
  },
  {
    href: "/resources/deploy-signa-on-premise",
    label: "On-premise deployment",
    icon: Building2Icon,
  },
  {
    href: "/docs/api",
    label: "API reference",
    icon: BracesIcon,
  },
];

export const embeddingExamples = [
  {
    title: "React signing form",
    command: "pnpm add @signajs/react",
    code: `<SignaForm src="https://signa.example.com/s/{submitterSlug}" withDownloadButton />`,
  },
  {
    title: "React builder",
    command: "pnpm add @signajs/react",
    code: `<SignaBuilder token="{builderToken}" host="https://signa.example.com" withSendButton />`,
  },
  {
    title: "React Native",
    command: "pnpm add @signajs/react-native react-native-webview",
    code: `<SignaSigningView src={signingUrl} onComplete={handleComplete} />`,
  },
  {
    title: "Browser custom element",
    command: "script src=https://cdn.jsdelivr.net/npm/@signajs/react/dist/form.js",
    code: `<signa-form src="https://signa.example.com/s/{submitterSlug}"></signa-form>`,
  },
];

export const webhookEvents = [
  "form.viewed",
  "form.started",
  "form.completed",
  "form.declined",
  "submission.created",
  "submission.completed",
  "submission.expired",
  "submission.archived",
  "template.created",
  "template.updated",
  "template.archived",
];

export function findGuide(slug: string): DocsArticle | undefined {
  const aliases: Record<string, string> = {
    "pre-fill-pdf-document-form-fields-with-api":
      "pre-fill-document-fields-with-api",
  };

  return guideArticles.find(
    (article) => article.slug === (aliases[slug] ?? slug),
  );
}

export function findResource(slug: string): DocsArticle | undefined {
  return resourceArticles.find((article) => article.slug === slug);
}
