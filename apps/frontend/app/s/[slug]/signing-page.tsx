"use client";

import { BrandAttribution } from "@/components/branding/brand-attribution";
import { SigningBrandStyle, signingNavigationUrl } from "@/components/branding/signing-brand-style";
import { BrandLogo } from "@/components/branding/brand-logo";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  CheckCircle2Icon,
  DownloadIcon,
  FileWarningIcon,
  MailIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ApiError } from "@/lib/api/http";
import {
  getAuthSession,
  getProfileAsset,
  type ProfileAsset,
} from "@/lib/api/auth";
import {
  completeSigningForm,
  declineSigningForm,
  getSigningDownload,
  getSigningForm,
  sendSigningCompletedCopy,
  type SigningField,
  type SigningFieldArea,
  type SigningForm,
  updateSigningValues,
  uploadSigningAttachment,
} from "@/lib/api/signing";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";

const loadSignaturePanel = () => import("./signature-panel");
const SignaturePanel = dynamic(() => loadSignaturePanel().then((module) => module.SignaturePanel));

type ActivePanelState = {
  field: SigningField;
  mode: "complete" | "field";
};

type SigningChoiceOption = {
  uuid: string;
  value: string;
};

type SavedSignerAssets = {
  initials: ProfileAsset | null;
  signature: ProfileAsset | null;
};

export function SigningPage({
  focusFieldPrefix,
  slug,
  trackingParam,
}: {
  focusFieldPrefix?: string;
  slug: string;
  trackingParam?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<SigningForm | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeclineOpen, setIsDeclineOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRedirectingCompletedForm, setIsRedirectingCompletedForm] =
    useState(false);
  const [savedAssets, setSavedAssets] = useState<SavedSignerAssets>({
    initials: null,
    signature: null,
  });

  useEffect(() => {
    void loadSignaturePanel();
    getSigningForm(slug, trackingParam)
      .then((loadedForm) => {
        if (loadedForm.submitter.completed_at) {
          setIsRedirectingCompletedForm(true);
          router.replace(signingNavigationUrl(`/s/${loadedForm.submitter.slug}/completed`));
          return;
        }

        setForm(loadedForm);
        postSignaEmbedEvent("init", loadedForm);
        postSignaEmbedEvent("load", loadedForm);
        setActivePanel(
          isClosedSigningForm(loadedForm)
            ? null
            : getInitialPanelState(loadedForm, focusFieldPrefix),
        );
        void loadSavedSignerAssets(loadedForm).then(setSavedAssets);
      })
      .catch((loadError: unknown) => {
        const message =
          loadError instanceof Error
            ? loadError.message
            : "Signing form could not be loaded.";

        setError(message);
        postSignaEmbedEvent("error", {
          code: "signing_form_load_failed",
          message,
        });
      })
      .finally(() => setIsLoading(false));
  }, [focusFieldPrefix, router, slug, trackingParam]);

  useEffect(() => {
    if (!isIframeEmbeddedSigningPage()) {
      return;
    }

    const observer = new ResizeObserver(() => {
      postSignaEmbedResize();
    });

    observer.observe(document.body);
    postSignaEmbedResize();

    return () => observer.disconnect();
  }, []);

  const orderedFields = useMemo(() => {
    if (!form) {
      return [];
    }

    return form.fields;
  }, [form]);

  async function saveFieldValue(
    field: SigningField,
    value: unknown,
    extraValues: Record<string, unknown> = {},
  ) {
    if (!form) {
      return;
    }

    const fieldKey = getFieldKey(field);
    const nextValues = { ...form.values, ...extraValues, [fieldKey]: value };
    const updatedForm = await updateSigningValues(slug, nextValues);

    setForm(updatedForm);
    setActivePanel(getNextPanelState(updatedForm, field));
  }

  async function completeForm(
    field: SigningField,
    value: unknown,
    extraValues: Record<string, unknown> = {},
  ) {
    if (!form) {
      return;
    }

    const fieldKey = getFieldKey(field);
    const nextValues = { ...form.values, ...extraValues, [fieldKey]: value };
    const completedForm = await completeSigningForm(slug, nextValues);

    setForm(completedForm);
    setActivePanel(null);
    postSignaEmbedEvent("completed", completedForm);
    showCompletionConfetti(completedForm.configs.with_confetti);
    toast.success("Document completed");
  }

  async function uploadFieldAttachment(file: File, type: string) {
    const attachment = await uploadSigningAttachment(slug, file, type);

    return attachment.uuid;
  }

  async function declineForm() {
    const declinedForm = await declineSigningForm(slug);

    setForm(declinedForm);
    setActivePanel(null);
    setIsDeclineOpen(false);
    postSignaEmbedEvent("declined", declinedForm);
    toast.success("Document declined");
  }

  async function downloadDocuments() {
    setIsDownloading(true);

    try {
      const download = await getSigningDownload(slug);

      download.documents.forEach((document) => {
        const link = window.document.createElement("a");
        link.href = document.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.download = document.filename;
        link.click();
      });
    } catch (downloadError) {
      toast.error("Download failed", {
        description: getDownloadErrorMessage(downloadError),
      });
    } finally {
      setIsDownloading(false);
    }
  }

  async function sendCopyViaEmail() {
    try {
      await sendSigningCompletedCopy(slug);
      toast.success("Document copy email queued");
    } catch (copyError) {
      toast.error("Copy email failed", {
        description:
          copyError instanceof Error
            ? copyError.message
            : "Document copy email could not be sent.",
      });
    }
  }

  if (isLoading || isRedirectingCompletedForm) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-[var(--auth-background)] text-[var(--auth-foreground)]" id="main-content" tabIndex={-1}>
        <div className="flex items-center gap-3 text-sm font-semibold">
          <Spinner />
          Loading signing form
        </div>
      </main>
    );
  }

  if (error || !form) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-[var(--auth-background)] px-6 text-[var(--auth-foreground)]" id="main-content" tabIndex={-1}>
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <FileWarningIcon className="size-10 text-[var(--auth-primary)]" />
          <h1 className="text-2xl font-bold">Signing form unavailable</h1>
          <p className="text-sm text-[var(--auth-muted-foreground)]">
            {error ?? "This signing link could not be opened."}
          </p>
        </div>
      </main>
    );
  }

  const isCompleted = Boolean(form.submitter.completed_at);
  const isDeclined = Boolean(form.submitter.declined_at);
  const isReadOnly = isCompleted || isDeclined;

  return (
    <main
      className="min-h-svh bg-[var(--auth-background)] text-[var(--auth-foreground)]"
      id="main-content"
      tabIndex={-1}
    >
      <div className="mx-auto flex w-full max-w-[1000px] flex-col px-3 py-3 sm:px-6 sm:py-4">
        <header className="mx-auto flex w-full max-w-[920px] flex-col gap-3 pb-1 sm:gap-4 sm:pb-2">
          <div className="flex justify-center">
            <SigningBrandStyle branding={form.branding} />
            <BrandLogo branding={form.branding ?? null} />
          </div>
        </header>

        <div className="sticky top-0 z-30 mx-auto mb-3 flex w-full max-w-[920px] items-center justify-between gap-3 bg-[var(--auth-background)]/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-[var(--auth-background)]/90 sm:mb-4">
          <h1 className="min-w-0 flex-1 truncate text-xl font-bold sm:text-3xl">
            {form.title}
          </h1>
          <div className="flex shrink-0 items-center justify-end gap-2">
            {form.configs.with_decline ? (
              <Button
                className="h-10 rounded-full bg-[var(--auth-muted)] px-4 text-xs font-bold text-[var(--auth-muted-foreground)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)] sm:h-9 sm:px-5"
                disabled={isCompleted || isDeclined}
                onClick={() => setIsDeclineOpen(true)}
                type="button"
                variant="ghost"
              >
                DECLINE
              </Button>
            ) : null}
            <Button
              aria-label="Download"
              className="size-10 rounded-full bg-[var(--auth-primary)] p-0 text-xs font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)] sm:h-9 sm:w-auto sm:px-5"
              disabled={isDownloading}
              onClick={() => void downloadDocuments()}
              type="button"
            >
              {isDownloading ? (
                <Spinner className="size-4" />
              ) : (
                <DownloadIcon className="size-5 sm:size-4" />
              )}
              <span className="hidden sm:inline">DOWNLOAD</span>
            </Button>
          </div>
        </div>

        {isDeclined ? (
          <div
            className={cn(
              "mx-auto mb-4 flex w-full max-w-[920px] items-start gap-3 rounded-lg border px-4 py-3 text-sm font-semibold shadow-sm",
              "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
            <span>This document has been declined.</span>
          </div>
        ) : null}

        <section
          className={cn(
            "flex flex-col items-center gap-4 sm:gap-5",
            isCompleted
              ? "pb-80 sm:pb-72"
              : isDeclined
                ? "pb-8"
                : "pb-64 sm:pb-36",
          )}
        >
          {form.documents.map((document, documentIndex) =>
            document.preview_images.map((previewImage, pageIndex) => (
              <DocumentPage
                activeFieldUuid={
                  isReadOnly ? null : activePanel?.field.uuid ?? null
                }
                documentUuid={document.uuid}
                fields={orderedFields}
                form={form}
                isReadOnly={isReadOnly}
                key={`${document.uuid}-${previewImage.id ?? pageIndex}`}
                onSelectField={(field) =>
                  setActivePanel({ field, mode: "field" })
                }
                pageIndex={pageIndex}
                priority={documentIndex === 0 && pageIndex === 0}
                previewImage={previewImage}
              />
            )),
          )}
          <BrandAttribution branding={form.branding} />
        </section>
      </div>

      {!isCompleted && !isDeclined ? (
        <SignaturePanel
          activeField={activePanel?.field ?? getInitialPanelState(form)?.field}
          fields={orderedFields}
          form={form}
          onFormChange={setForm}
          onComplete={completeForm}
          onSaveField={saveFieldValue}
          onSelectField={(field) => setActivePanel({ field, mode: "field" })}
          onUploadAttachment={uploadFieldAttachment}
          savedAssets={savedAssets}
        />
      ) : isCompleted ? (
        <CompletedSigningPanel
          form={form}
          isDownloading={isDownloading}
          onDownload={() => void downloadDocuments()}
          onSendCopy={() => void sendCopyViaEmail()}
        />
      ) : null}

      <AlertDialog open={isDeclineOpen} onOpenChange={setIsDeclineOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Decline this document?</AlertDialogTitle>
          <AlertDialogDescription>
            This marks your signing link as declined. You will not be able to
            complete this document from this session afterward.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void declineForm()}
            >
              Decline document
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function CompletedSigningPanel({
  form,
  isDownloading,
  onDownload,
  onSendCopy,
}: {
  form: SigningForm;
  isDownloading: boolean;
  onDownload: () => void;
  onSendCopy: () => void;
}) {
  const message = form.configs.completed_message;
  const button = form.configs.completed_button;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-0 sm:bottom-4 sm:px-4">
      <section
        className="w-full rounded-t-xl border border-[var(--auth-input-border)] bg-card px-5 py-5 text-center shadow-2xl sm:max-w-3xl sm:rounded-xl sm:px-8"
        role="status"
      >
        <div className="flex items-center justify-center gap-2 text-2xl font-bold text-[var(--auth-primary)]">
          <CheckCircle2Icon className="size-7 text-emerald-500" />
          <span>{message.title || getDefaultCompletedTitle(form)}</span>
        </div>
        {message.body ? (
          <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--auth-muted-foreground)]">
            {message.body}
          </p>
        ) : null}
        <div className="mx-auto mt-5 flex max-w-xl flex-col gap-3">
          {button.title && button.url ? (
            <Button
              asChild
              className="h-12 rounded-full border-[var(--auth-primary)] text-sm font-bold text-[var(--auth-primary)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)]"
              variant="outline"
            >
              <a href={button.url} rel="noreferrer" target="_blank">
                {button.title}
              </a>
            </Button>
          ) : null}
          <Button
            className="h-12 rounded-full border-[var(--auth-primary)] text-sm font-bold text-[var(--auth-primary)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)]"
            onClick={onSendCopy}
            type="button"
            variant="outline"
          >
            <MailIcon data-icon="inline-start" />
            SEND COPY VIA EMAIL
          </Button>
          <Button
            className="h-12 rounded-full bg-[var(--auth-primary)] text-sm font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
            disabled={isDownloading}
            onClick={onDownload}
            type="button"
          >
            {isDownloading ? (
              <Spinner className="size-4" />
            ) : (
              <DownloadIcon data-icon="inline-start" />
            )}
            DOWNLOAD
          </Button>
        </div>
        <BrandAttribution branding={form.branding} />
        <SigningProgressDots isComplete total={getSigningStepCount(form)} />
      </section>
    </div>
  );
}

function getDefaultCompletedTitle(form: SigningForm): string {
  const signatureFields = form.fields.filter((field) =>
    ["signature", "initials"].includes(field.type ?? ""),
  );

  if (!signatureFields.length) {
    return "Form has been completed!";
  }

  return form.documents.length > 1
    ? "Documents have been signed!"
    : "Document has been signed!";
}

async function loadSavedSignerAssets(
  form: SigningForm,
): Promise<SavedSignerAssets> {
  const emptyAssets = { initials: null, signature: null };

  if (!form.configs.prefill_signature || !form.submitter.email) {
    return emptyAssets;
  }

  const currentUser = getAuthSession()?.user;

  if (
    !currentUser?.email ||
    currentUser.email.toLowerCase() !== form.submitter.email.toLowerCase()
  ) {
    return emptyAssets;
  }

  try {
    const [signature, initials] = await Promise.all([
      getProfileAsset("signature"),
      getProfileAsset("initials"),
    ]);

    return { initials, signature };
  } catch {
    return emptyAssets;
  }
}

function showCompletionConfetti(isEnabled: boolean) {
  if (!isEnabled) {
    return;
  }

  void import("canvas-confetti").then(({ default: confetti }) => confetti({
    particleCount: 140,
    spread: 70,
    origin: { y: 0.7 },
  }));
}

function DocumentPage({
  activeFieldUuid,
  documentUuid,
  fields,
  form,
  isReadOnly,
  onSelectField,
  pageIndex,
  priority,
  previewImage,
}: {
  activeFieldUuid: string | null;
  documentUuid: string;
  fields: SigningField[];
  form: SigningForm;
  isReadOnly: boolean;
  onSelectField: (field: SigningField) => void;
  pageIndex: number;
  priority: boolean;
  previewImage: {
    id: string;
    metadata?: { height?: number; width?: number } | null;
    url: string;
  };
}) {
  const width = previewImage.metadata?.width ?? 1000;
  const height = previewImage.metadata?.height ?? 1400;
  const pageFields = fields.filter((field) =>
    field.areas?.some(
      (area) =>
        area.attachment_uuid === documentUuid && area.page === pageIndex,
    ),
  );

  return (
    <div
      className="relative w-full max-w-[920px] overflow-hidden rounded border border-[var(--auth-input-border)] bg-white shadow-sm"
      style={{ aspectRatio: `${width} / ${height}`, containerType: "inline-size" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={`${form.title} page ${pageIndex + 1}`}
        className="h-full w-full object-contain"
        height={height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        src={previewImage.url}
        width={width}
      />
      <div className="absolute inset-0">
        {pageFields.map((field) =>
          (field.areas ?? [])
            .filter(
              (area) =>
                area.attachment_uuid === documentUuid &&
                area.page === pageIndex,
            )
            .map((area, areaIndex) => (
              <SigningFieldOverlay
                area={area}
                field={field}
                form={form}
                isActive={field.uuid === activeFieldUuid}
                isReadOnly={isReadOnly}
                key={`${field.uuid}-${areaIndex}`}
                onSelectField={onSelectField}
              />
            )),
        )}
      </div>
    </div>
  );
}

function SigningFieldOverlay({
  area,
  field,
  form,
  isActive,
  isReadOnly,
  onSelectField,
}: {
  area: SigningFieldArea;
  field: SigningField;
  form: SigningForm;
  isActive: boolean;
  isReadOnly: boolean;
  onSelectField: (field: SigningField) => void;
}) {
  const content = <span className="flex h-full w-full items-center justify-center overflow-hidden" style={{ fontSize: "clamp(5px, 1.52cqw, 14px)", lineHeight: 1 }}><FieldDisplayValue area={area} field={field} form={form} /></span>;
  const label = field.name || field.title || getDefaultFieldTitle(field);
  const hasValue = hasAreaValue(form, field, area);
  const isOptionArea = isNativeChoiceArea(field, area);
  const className = cn(
    "group/signing-field absolute flex appearance-none items-center justify-center overflow-visible px-0.5 text-left text-[var(--auth-primary)] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    isActive && !isReadOnly
      ? "z-10 outline outline-2 -outline-offset-1 outline-dashed outline-red-500"
      : "",
    hasValue
      ? "border border-red-200 bg-red-100/75"
      : "border border-transparent bg-red-100/85",
    !isReadOnly && "cursor-pointer hover:bg-red-100/95",
  );

  if (isReadOnly || isOptionArea) {
    return (
      <div
        aria-label={`${label}${hasValue ? ", completed" : ""}`}
        aria-pressed={isActive}
        className={cn(className, !isReadOnly && "cursor-pointer")}
        onClick={isReadOnly ? undefined : () => onSelectField(field)}
        onKeyDown={
          isReadOnly
            ? undefined
            : (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectField(field);
                }
              }
        }
        role={isReadOnly ? undefined : "button"}
        style={areaToStyle(area)}
        tabIndex={isReadOnly ? undefined : 0}
      >
        <SigningFieldLabel isActive={isActive} label={label} />
        {content}
      </div>
    );
  }

  return (
    <button
      className={className}
      onClick={() => onSelectField(field)}
      style={areaToStyle(area)}
      type="button"
    >
      <SigningFieldLabel isActive={isActive} label={label} />
      {content}
    </button>
  );
}

function SigningFieldLabel({
  isActive,
  label,
}: {
  isActive: boolean;
  label: string;
}) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute -top-7 left-0 z-20 max-w-[min(240px,90vw)] truncate rounded bg-[var(--auth-primary)] px-2 py-0.5 text-sm font-bold text-[var(--auth-primary-foreground)] shadow-sm transition-opacity",
        isActive
          ? "opacity-100"
          : "opacity-0 group-hover/signing-field:opacity-100",
      )}
    >
      {label}
    </span>
  );
}

function FieldDisplayValue({
  area,
  field,
  form,
}: {
  area: SigningFieldArea;
  field: SigningField;
  form: SigningForm;
}) {
  const value = form.values[getFieldKey(field)] ?? field.default_value;
  const attachment = getValueAttachment(form, value);

  if (field.type === "signature" || field.type === "initials") {
    if (attachment) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={field.name || field.title || field.type}
          className="h-full w-full object-contain"
          height={160}
          src={attachment.url}
          width={320}
        />
      );
    }

    return (
      <span className="text-[length:inherit] font-bold">
        {isBlankValue(value) ? "Sign Here" : "Signed"}
      </span>
    );
  }

  if (field.type === "checkbox") {
    return <ChoiceMark isSelected={Boolean(value)} shape="square" />;
  }

  if (["multiple", "radio", "select"].includes(field.type ?? "")) {
    return <ChoiceFieldDisplay area={area} field={field} value={value} />;
  }

  if (
    field.type === "image" ||
    field.type === "stamp" ||
    field.type === "file"
  ) {
    if ((field.type === "image" || field.type === "stamp") && attachment) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={attachment.filename}
          className="h-full w-full object-contain"
          height={160}
          src={attachment.url}
          width={320}
        />
      );
    }

    return (
      <span className="truncate text-[length:inherit] font-semibold">
        {isBlankValue(value)
          ? field.name || field.title || "Upload"
          : "Uploaded"}
      </span>
    );
  }

  return (
    <span className="flex w-full items-center truncate px-0.5 text-[length:inherit] font-semibold">
      {isBlankValue(value)
        ? field.name || field.title || "Field"
        : String(value)}
    </span>
  );
}

function ChoiceFieldDisplay({
  area,
  field,
  value,
}: {
  area: SigningFieldArea;
  field: SigningField;
  value: unknown;
}) {
  const options = getSigningChoiceOptions(field);

  if (area.option_uuid) {
    const option = options.find((item) => item.uuid === area.option_uuid);
    const isSelected = option ? isOptionSelected(value, option) : false;
    const label = option?.value ?? "Option";

    return (
      <span className="flex h-full w-full items-center justify-center text-[var(--auth-primary)]">
        <ChoiceMark
          isSelected={isSelected}
          shape={field.type === "radio" ? "circle" : "square"}
        />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  const selectedLabels = options
    .filter((option) => isOptionSelected(value, option))
    .map((option) => option.value);

  return (
    <span className="truncate text-[length:inherit] font-semibold">
      {selectedLabels.length
        ? selectedLabels.join(", ")
        : field.name || field.title || "Select"}
    </span>
  );
}

function ChoiceMark({
  isSelected,
  shape,
}: {
  isSelected: boolean;
  shape: "circle" | "square";
}) {
  return (
    <span
      className={cn(
        "flex aspect-square h-[min(100%,1.75rem)] max-h-7 items-center justify-center border bg-white text-[length:inherit] font-bold leading-none text-[var(--auth-primary)]",
        shape === "circle" ? "rounded-full" : "rounded-[4px]",
        isSelected
          ? "border-[var(--auth-primary)] bg-[var(--auth-primary)] text-[var(--auth-primary-foreground)]"
          : "border-[var(--auth-input-border)]",
      )}
    >
      {isSelected ? (shape === "circle" ? "" : "✓") : ""}
      {isSelected && shape === "circle" ? (
        <span className="size-3 rounded-full bg-[var(--auth-primary)] ring-4 ring-white" />
      ) : null}
    </span>
  );
}

function isNativeChoiceArea(
  field: SigningField,
  area: SigningFieldArea,
): boolean {
  return (
    field.type === "checkbox" ||
    ((field.type === "multiple" || field.type === "radio") &&
      typeof area.option_uuid === "string")
  );
}

function hasAreaValue(
  form: SigningForm,
  field: SigningField,
  area: SigningFieldArea,
): boolean {
  const value = form.values[getFieldKey(field)] ?? field.default_value;

  if (["multiple", "radio", "select"].includes(field.type ?? "")) {
    const option = getSigningChoiceOptions(field).find(
      (item) => item.uuid === area.option_uuid,
    );

    return option ? isOptionSelected(value, option) : !isBlankValue(value);
  }

  return !isBlankValue(value);
}

function getValueAttachment(form: SigningForm, value: unknown) {
  const uuid = typeof value === "string" ? value : null;

  if (!uuid) {
    return null;
  }

  return (
    form.attachments.find((attachment) => attachment.uuid === uuid) ?? null
  );
}

function getInitialPanelState(
  form: SigningForm,
  focusFieldPrefix?: string,
): ActivePanelState | null {
  const sortedFields = form.fields;
  const focusedField = focusFieldPrefix
    ? sortedFields.find((field) => field.uuid?.startsWith(focusFieldPrefix))
    : null;
  const field =
    focusedField ??
    sortedFields.find(
      (candidate) => !candidate.readonly && !hasFieldValue(form, candidate),
    );

  return field ? { field, mode: "field" } : null;
}

function isClosedSigningForm(form: SigningForm): boolean {
  return Boolean(form.submitter.completed_at || form.submitter.declined_at);
}

function getNextPanelState(
  form: SigningForm,
  currentField: SigningField,
): ActivePanelState | null {
  const fields = form.fields;
  const currentIndex = fields.findIndex(
    (field) => getFieldKey(field) === getFieldKey(currentField),
  );
  const nextField = fields
    .slice(Math.max(currentIndex + 1, 0))
    .find((field) => !field.readonly);

  return nextField ? { field: nextField, mode: "field" } : null;
}

function areaToStyle(area: { h?: number; w?: number; x?: number; y?: number }) {
  return {
    height: `${(area.h ?? 0.04) * 100}%`,
    left: `${(area.x ?? 0) * 100}%`,
    top: `${(area.y ?? 0) * 100}%`,
    width: `${(area.w ?? 0.2) * 100}%`,
  };
}

function hasFieldValue(form: SigningForm, field: SigningField): boolean {
  return !isBlankValue(form.values[getFieldKey(field)]);
}

function getSigningStepCount(form: SigningForm): number {
  return Math.max(
    1,
    form.fields.filter((field) => !field.readonly).length,
  );
}

function SigningProgressDots({
  activeIndex,
  isComplete = false,
  total,
}: {
  activeIndex?: number;
  isComplete?: boolean;
  total: number;
}) {
  const cappedTotal = Math.min(Math.max(total, 1), 8);

  return (
    <div className="mt-4 flex justify-center gap-2">
      {Array.from({ length: cappedTotal }).map((_, index) => (
        <span
          aria-hidden="true"
          className={cn(
            "size-2.5 rounded-full border border-[var(--auth-primary)]/20",
            isComplete || index === activeIndex
              ? "bg-[var(--auth-primary)]"
              : "bg-[var(--auth-muted)]",
          )}
          key={index}
        />
      ))}
    </div>
  );
}

function getFieldKey(field: SigningField): string {
  return field.uuid ?? field.name ?? "field";
}

function getDefaultFieldTitle(field: SigningField): string {
  switch (field.type) {
    case "date":
      return "Date";
    case "file":
      return "File";
    case "image":
      return "Image";
    case "initials":
      return "Initials";
    case "multiple":
      return "Multiple choice";
    case "number":
      return "Number";
    case "payment":
      return "Payment";
    case "phone":
      return "Phone";
    case "radio":
      return "Radio";
    case "select":
      return "Select";
    case "signature":
      return "Signature";
    case "stamp":
      return "Stamp";
    case "text":
      return "Text";
    default:
      return "Field";
  }
}

function isBlankValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function isOptionSelected(
  value: unknown,
  option: SigningChoiceOption,
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => isOptionSelected(item, option));
  }

  if (typeof value !== "string") {
    return false;
  }

  return value === option.value || value === option.uuid;
}

function getSigningChoiceOptions(field: SigningField): SigningChoiceOption[] {
  const rawOptions = getSigningRawOptions(field);

  if (!rawOptions.length) {
    return getSigningAreaOptions(field);
  }

  return rawOptions.map((option, index) => {
    const fallbackUuid = `${field.uuid ?? field.name ?? "field"}-${index}`;
    const optionRecord = isSigningOptionRecord(option) ? option : {};
    const label =
      getSigningOptionString(option) ||
      getSigningOptionString(optionRecord.value) ||
      getSigningOptionString(optionRecord.label) ||
      getSigningOptionString(optionRecord.name) ||
      getSigningOptionString(optionRecord.title) ||
      getSigningOptionString(optionRecord.text);

    return {
      uuid: getSigningOptionString(optionRecord.uuid) || fallbackUuid,
      value: label || `Option ${index + 1}`,
    };
  });
}

function getSigningRawOptions(field: SigningField): unknown[] {
  if (Array.isArray(field.options)) {
    return field.options;
  }

  const preferencesOptions = field.preferences?.options;

  return Array.isArray(preferencesOptions) ? preferencesOptions : [];
}

function getSigningAreaOptions(field: SigningField): SigningChoiceOption[] {
  return (field.areas ?? [])
    .filter((area) => typeof area.option_uuid === "string")
    .map((area, index) => ({
      uuid: area.option_uuid ?? `${field.uuid ?? field.name ?? "field"}-${index}`,
      value: `Option ${index + 1}`,
    }));
}

function getDownloadErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return "Authentication is required to download completed documents for this account.";
  }

  return error instanceof Error
    ? error.message
    : "Document could not be downloaded.";
}

function isSigningOptionRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getSigningOptionString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isEmbeddedSigningPage() {
  return (
    typeof window !== "undefined" &&
    (isIframeEmbeddedSigningPage() || isReactNativeSigningPage())
  );
}

function postSignaEmbedEvent(type: string, detail: unknown) {
  if (!isEmbeddedSigningPage()) {
    return;
  }

  window.parent.postMessage(
    {
      detail,
      source: "signa",
      type,
    },
    "*",
  );

  window.ReactNativeWebView?.postMessage(
    JSON.stringify({
      payload: detail,
      type: getReactNativeEventType(type),
    }),
  );
}

function postSignaEmbedResize() {
  if (!isIframeEmbeddedSigningPage()) {
    return;
  }

  window.parent.postMessage(
    {
      height: document.documentElement.scrollHeight,
      source: "signa",
      type: "resize",
    },
    "*",
  );
}

function getReactNativeEventType(type: string) {
  if (type === "load") {
    return "signa:loaded";
  }

  return `signa:${type}`;
}

function isReactNativeSigningPage() {
  return Boolean(window.ReactNativeWebView);
}

function isIframeEmbeddedSigningPage() {
  return (
    typeof window !== "undefined" &&
    window.parent !== window &&
    new URLSearchParams(window.location.search).get("embed") === "true"
  );
}

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
  }
}
