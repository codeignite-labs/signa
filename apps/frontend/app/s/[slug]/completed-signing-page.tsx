"use client";

import { BrandAttribution } from "@/components/branding/brand-attribution";
import { SigningBrandStyle, signingNavigationUrl } from "@/components/branding/signing-brand-style";
import { BrandLogo } from "@/components/branding/brand-logo";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DownloadIcon,
  FileWarningIcon,
  MailIcon,
  RefreshCwIcon,
  SignatureIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ApiError } from "@/lib/api/http";
import {
  getSigningDownload,
  getSigningForm,
  resubmitSigningForm,
  sendSigningCompletedCopy,
  type SigningForm,
} from "@/lib/api/signing";

export function CompletedSigningPage({ slug }: { slug: string }) {
  const router = useRouter();
  const [form, setForm] = useState<SigningForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isResubmitting, setIsResubmitting] = useState(false);
  const [isSendingCopy, setIsSendingCopy] = useState(false);

  useEffect(() => {
    getSigningForm(slug)
      .then((loadedForm) => {
        if (!loadedForm.submitter.completed_at) {
          router.replace(signingNavigationUrl(`/s/${loadedForm.submitter.slug}`));
          return;
        }

        setForm(loadedForm);
      })
      .catch((loadError: unknown) => {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Completed document could not be loaded.",
        );
      })
      .finally(() => setIsLoading(false));
  }, [router, slug]);

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
    setIsSendingCopy(true);

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
    } finally {
      setIsSendingCopy(false);
    }
  }

  async function resubmit() {
    setIsResubmitting(true);

    try {
      const nextForm = await resubmitSigningForm(slug);

      router.replace(signingNavigationUrl(`/s/${nextForm.submitter.slug}`));
    } catch (resubmitError) {
      toast.error("Resubmit failed", {
        description:
          resubmitError instanceof Error
            ? resubmitError.message
            : "This document cannot be resubmitted.",
      });
    } finally {
      setIsResubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-[var(--auth-background)] text-[var(--auth-foreground)]" id="main-content" tabIndex={-1}>
        <div className="flex items-center gap-3 text-sm font-semibold">
          <Spinner />
          Loading completed document
        </div>
      </main>
    );
  }

  if (error || !form) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-[var(--auth-background)] px-6 text-[var(--auth-foreground)]" id="main-content" tabIndex={-1}>
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <FileWarningIcon className="size-10 text-[var(--auth-primary)]" />
          <h1 className="text-2xl font-bold">Completed document unavailable</h1>
          <p className="text-sm text-[var(--auth-muted-foreground)]">
            {error ?? "This completed signing link could not be opened."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-svh bg-[var(--auth-background)] px-4 py-12 text-[var(--auth-foreground)]"
      id="main-content"
      tabIndex={-1}
    >
      <section className="mx-auto flex w-full max-w-md flex-col items-stretch gap-5">
        <div className="flex justify-center">
          <SigningBrandStyle branding={form.branding} />
          <BrandLogo branding={form.branding ?? null} />
        </div>

        <div className="flex items-center gap-4 rounded-xl bg-[var(--auth-muted)] p-4">
          <SignatureIcon className="size-10 shrink-0 text-[var(--auth-primary)]" />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{form.title}</p>
            <p className="text-sm text-[var(--auth-muted-foreground)]">
              {getCompletedSummary(form)}
            </p>
          </div>
        </div>

        <Button
          className="h-12 rounded-full border-[var(--auth-primary)] text-sm font-bold text-[var(--auth-primary)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)]"
          disabled={isSendingCopy}
          onClick={() => void sendCopyViaEmail()}
          type="button"
          variant="outline"
        >
          {isSendingCopy ? (
            <Spinner className="size-4" />
          ) : (
            <MailIcon data-icon="inline-start" />
          )}
          SEND COPY TO EMAIL
        </Button>

        <Button
          className="h-12 rounded-full bg-[var(--auth-primary)] text-sm font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
          disabled={isDownloading}
          onClick={() => void downloadDocuments()}
          type="button"
        >
          {isDownloading ? (
            <Spinner className="size-4" />
          ) : (
            <DownloadIcon data-icon="inline-start" />
          )}
          DOWNLOAD DOCUMENTS
        </Button>

        <div className="flex items-center gap-4 text-sm font-semibold text-[var(--auth-foreground)]">
          <span className="h-px flex-1 bg-[var(--auth-input-border)]" />
          <span>OR</span>
          <span className="h-px flex-1 bg-[var(--auth-input-border)]" />
        </div>

        <Button
          className="h-12 rounded-full border-[var(--auth-primary)] text-sm font-bold text-[var(--auth-primary)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)]"
          disabled={isResubmitting}
          onClick={() => void resubmit()}
          type="button"
          variant="outline"
        >
          {isResubmitting ? (
            <Spinner className="size-4" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          RESUBMIT
        </Button>

        <BrandAttribution branding={form.branding} />
      </section>
    </main>
  );
}

function getCompletedSummary(form: SigningForm): string {
  const completedAt = form.submitter.completed_at;
  const completedDate = completedAt
    ? new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }).format(new Date(completedAt))
    : "";
  const label = hasSignatureFields(form) ? "Signed" : "Completed";

  return completedDate ? `${label} on ${completedDate}` : `${label} already`;
}

function hasSignatureFields(form: SigningForm): boolean {
  return form.fields.some((field) =>
    ["signature", "initials"].includes(field.type ?? ""),
  );
}

function getDownloadErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return "Authentication is required to download completed documents for this account.";
  }

  return error instanceof Error
    ? error.message
    : "Document could not be downloaded.";
}
