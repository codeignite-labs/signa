import React from "react";

export type SignaFormField = {
  name: string;
  title?: string;
  description?: string;
  type?: string;
  position?: number;
  required?: boolean;
  readonly?: boolean;
  validation?: {
    pattern?: string;
    message?: string;
  };
  preferences?: {
    font_size?: number;
    font_type?: "bold" | "italic" | "bold_italic";
    mask?: boolean | number;
    font?: "Times" | "Helvetica" | "Courier";
    color?: "black" | "white" | "blue";
    align?: "left" | "center" | "right";
    valign?: "top" | "center" | "bottom";
    format?: string;
    price?: number;
    currency?: "USD" | "EUR" | "GBP" | "CAD" | "AUD";
  };
};

export type SignaFormLoadData = {
  sandbox: boolean;
  template: {
    id: number;
    name: string;
    shared_link: boolean;
  };
  submission: {
    id: number;
    name: string | null;
  } | null;
  submitter: {
    id: number;
    email: string;
    slug: string;
    name: string | null;
    phone: string | null;
    values: Record<string, unknown>;
    uuid: string;
    external_id: string | null;
    preferences: Record<string, unknown>;
  } | null;
  values: Record<string, unknown>;
  logo: {
    url: string;
    metadata: Record<string, unknown>;
  } | null;
  completed_submitter: {
    id: number;
    submission_id: number;
    email: string;
    name: string | null;
    completed_at: string;
  } | null;
  expired_submitter: {
    id: number;
    submission_id: number;
    declined_at: string | null;
    expire_at: string;
  } | null;
};

type SignaFormSubmitterData = {
  id: number;
  submission_id: number;
  email: string;
  phone: string | null;
  name: string | null;
  ua: string;
  ip: string;
  sent_at: string | null;
  opened_at: string | null;
  completed_at: string | null;
  declined_at: string | null;
  created_at: string;
  updated_at: string;
  external_id: string | null;
  metadata: Record<string, unknown>;
  status: "completed" | "declined" | "expired" | "pending";
  decline_reason: string | null;
  role: string;
  preferences: Record<string, unknown>;
  values: Array<{
    field: string;
    value: unknown;
  }>;
  submission_url: string;
  template: {
    id: number;
    name: string;
    external_id: string | null;
    created_at: string;
    updated_at: string;
    folder_name: string | null;
  };
  submission: {
    id: number;
    audit_log_url: string | null;
    combined_document_url: string | null;
    status: "completed" | "declined" | "expired" | "pending";
    url: string;
    variables: Record<string, unknown>;
    created_at: string;
  };
};

export type SignaFormCompleteData = SignaFormSubmitterData;
export type SignaFormDeclineData = SignaFormSubmitterData;

export type SignaFormProps = {
  src?: string;
  token?: string;
  host?: string;
  scriptUrl?: string;
  role?: string;
  submitter?: string;
  expand?: boolean;
  minimize?: boolean;
  orderAsOnPage?: boolean;
  preview?: boolean;
  dryRun?: boolean;
  email?: string;
  name?: string;
  applicationKey?: string;
  externalId?: string;
  backgroundColor?: string;
  theme?: "light" | "dark" | "system";
  primaryColor?: string;
  logo?: string;
  language?: string;
  completedMessage?: {
    title?: string;
    body?: string;
  };
  completedRedirectUrl?: string;
  completedButton?: {
    title: string;
    url: string;
  };
  goToLast?: boolean;
  skipFields?: boolean;
  autoscrollFields?: boolean;
  withTitle?: boolean;
  withDecline?: boolean;
  withFieldNames?: boolean;
  withFieldPlaceholder?: boolean;
  sendCopyEmail?: boolean;
  withDownloadButton?: boolean;
  withSendCopyButton?: boolean;
  withCompleteButton?: boolean;
  onlyRequiredFields?: boolean;
  allowToResubmit?: boolean;
  allowTypedSignature?: boolean;
  signature?: string;
  rememberSignature?: boolean;
  reuseSignature?: boolean;
  values?: object;
  metadata?: object;
  i18n?: object;
  fields?: SignaFormField[];
  readonlyFields?: string[];
  onComplete?: (data: SignaFormCompleteData) => void;
  onInit?: () => void;
  onDecline?: (data: SignaFormDeclineData) => void;
  onLoad?: (data: SignaFormLoadData) => void;
  className?: string;
  customCss?: string;
  style?: React.CSSProperties;
};

const SignaForm = ({
  src = "",
  token = "",
  host = "",
  scriptUrl = "",
  role = "",
  submitter = "",
  preview = false,
  dryRun = false,
  expand = true,
  minimize = false,
  orderAsOnPage = false,
  email = "",
  name = "",
  backgroundColor = "",
  theme,
  primaryColor,
  sendCopyEmail,
  applicationKey = "",
  externalId = "",
  logo = "",
  language = "",
  completedRedirectUrl = "",
  completedButton = { title: "", url: "" },
  completedMessage = { title: "", body: "" },
  goToLast = true,
  skipFields = false,
  autoscrollFields = true,
  withTitle = true,
  withDecline = false,
  withFieldNames = true,
  withFieldPlaceholder = false,
  withDownloadButton = true,
  onlyRequiredFields = false,
  allowToResubmit = true,
  allowTypedSignature = true,
  signature = "",
  rememberSignature = false,
  reuseSignature = true,
  withSendCopyButton = true,
  withCompleteButton = false,
  values = {},
  metadata = {},
  i18n = {},
  fields = [],
  readonlyFields = [],
  onComplete = () => {},
  onInit = () => {},
  onDecline = () => {},
  onLoad = () => {},
  className = "",
  customCss = "",
  style = {},
}: SignaFormProps): React.ReactElement => {
  const scriptId = "signa-form-script";
  const scriptSrc = buildScriptUrl(scriptUrl, host, "/js/form.js");
  const appHost = host ? normalizeHost(host) : "";
  const isServer = typeof window === "undefined";
  const formRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    if (isServer || document.getElementById(scriptId)) {
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = scriptSrc;
    document.head.appendChild(script);
  }, [isServer, scriptSrc]);

  React.useEffect(() => {
    const el = formRef.current;
    const handleCompleted = (e: Event) => onComplete((e as CustomEvent).detail);

    el?.addEventListener("completed", handleCompleted);

    return () => {
      el?.removeEventListener("completed", handleCompleted);
    };
  }, [onComplete]);

  React.useEffect(() => {
    const el = formRef.current;
    const handleInit = () => onInit();

    el?.addEventListener("init", handleInit);

    return () => {
      el?.removeEventListener("init", handleInit);
    };
  }, [onInit]);

  React.useEffect(() => {
    const el = formRef.current;
    const handleDecline = (e: Event) => onDecline((e as CustomEvent).detail);

    el?.addEventListener("declined", handleDecline);

    return () => {
      el?.removeEventListener("declined", handleDecline);
    };
  }, [onDecline]);

  React.useEffect(() => {
    const el = formRef.current;
    const handleLoad = (e: Event) => onLoad((e as CustomEvent).detail);

    el?.addEventListener("load", handleLoad);

    return () => {
      el?.removeEventListener("load", handleLoad);
    };
  }, [onLoad]);

  const booleanToAttr = (value: unknown) =>
    value === true ? "true" : value === false ? "false" : value;

  return (
    <>
      {React.createElement("signa-form", {
        "data-src": src,
        "data-token": token,
        "data-host": appHost,
        "data-email": email,
        "data-name": name,
        "data-role": role || submitter,
        "data-external-id": externalId || applicationKey,
        "data-expand": booleanToAttr(expand),
        "data-minimize": booleanToAttr(minimize),
        "data-order-as-on-page": orderAsOnPage,
        "data-preview": booleanToAttr(preview),
        "data-dry-run": booleanToAttr(dryRun),
        "data-go-to-last": booleanToAttr(goToLast),
        "data-skip-fields": booleanToAttr(skipFields),
        "data-autoscroll-fields": booleanToAttr(autoscrollFields),
        "data-send-copy-email": booleanToAttr(sendCopyEmail),
        "data-with-title": booleanToAttr(withTitle),
        "data-with-decline": booleanToAttr(withDecline),
        "data-logo": logo,
        "data-language": language,
        "data-with-field-names": booleanToAttr(withFieldNames),
        "data-with-field-placeholder": booleanToAttr(withFieldPlaceholder),
        "data-with-download-button": booleanToAttr(withDownloadButton),
        "data-only-required-fields": booleanToAttr(onlyRequiredFields),
        "data-allow-to-resubmit": booleanToAttr(allowToResubmit),
        "data-allow-typed-signature": booleanToAttr(allowTypedSignature),
        "data-signature": signature,
        "data-remember-signature": booleanToAttr(rememberSignature),
        "data-reuse-signature": booleanToAttr(reuseSignature),
        "data-completed-redirect-url": completedRedirectUrl,
        "data-with-send-copy-button": booleanToAttr(withSendCopyButton),
        "data-with-complete-button": booleanToAttr(withCompleteButton),
        "data-values": JSON.stringify(values),
        "data-metadata": JSON.stringify(metadata),
        "data-fields": JSON.stringify(fields),
        "data-i18n": JSON.stringify(i18n),
        "data-readonly-fields": readonlyFields.join(","),
        "data-completed-message-title": completedMessage.title,
        "data-completed-message-body": completedMessage.body,
        "data-completed-button-title": completedButton.title,
        "data-completed-button-url": completedButton.url,
        "data-background-color": backgroundColor,
        "data-theme": theme,
        "data-primary-color": primaryColor,
        "data-custom-css": customCss,
        ref: formRef,
        className,
        style,
      })}
      {isServer && <script id={scriptId} src={scriptSrc} async />}
    </>
  );
};

export type DocusealFormField = SignaFormField;
export type DocusealFormLoadData = SignaFormLoadData;
export type DocusealFormCompleteData = SignaFormCompleteData;
export type DocusealFormDeclineData = SignaFormDeclineData;
export type DocusealFormProps = SignaFormProps;

export const DocusealForm = SignaForm;
export default SignaForm;

function normalizeHost(host: string): string {
  const trimmedHost = host.trim().replace(/\/+$/, "");

  if (trimmedHost.startsWith("http://") || trimmedHost.startsWith("https://")) {
    return trimmedHost;
  }

  return `https://${trimmedHost}`;
}

function buildScriptUrl(
  scriptUrl: string,
  host: string,
  defaultPath: string,
): string {
  if (scriptUrl) {
    return scriptUrl;
  }

  if (host) {
    return `${normalizeHost(host)}${defaultPath}`;
  }

  return DEFAULT_FORM_SCRIPT_URL;
}

const DEFAULT_FORM_SCRIPT_URL =
  "https://cdn.jsdelivr.net/npm/@signajs/react@latest/dist/form.js";
