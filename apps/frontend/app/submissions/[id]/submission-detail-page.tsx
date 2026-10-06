"use client"

import { BrandLogo } from "@/components/branding/brand-logo"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CopyIcon,
  DownloadIcon,
  ListIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { ApiError } from "@/lib/api/http"
import { useRealtimeEvents } from "@/lib/realtime/use-realtime-events"
import {
  getSubmission,
  getSubmissionDocuments,
  getSubmissionEvents,
  getSubmissionMailEvents,
  type SubmissionDocumentResponse,
  type SubmissionEventLogItem,
  type SubmissionMailEventResponse,
  type SubmissionResponse,
} from "@/lib/api/submissions"
import { getTemplate, type TemplateDocument } from "@/lib/api/templates"
import {
  compareFieldsByDocumentPosition,
} from "./submission-field-display"
import {
  SubmissionDocumentPreview,
  SubmissionDocumentThumbnails,
  type SubmissionPreviewDocument,
} from "./submission-document-viewer"
import { SubmissionEventLogDialog } from "./submission-event-log-dialog"
import { SubmissionPartiesPanel } from "./submission-parties-panel"

type SubmissionDetailPageProps = {
  submissionId: string
}

export function SubmissionDetailPage({ submissionId }: SubmissionDetailPageProps) {
  const router = useRouter()
  const [documents, setDocuments] = useState<SubmissionPreviewDocument[]>([])
  const [events, setEvents] = useState<SubmissionEventLogItem[]>([])
  const [mailEvents, setMailEvents] = useState<SubmissionMailEventResponse[]>([])
  const [isDownloading, setIsDownloading] = useState(false)
  const [isEventsLoading, setIsEventsLoading] = useState(false)
  const [isEventsOpen, setIsEventsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isShareLinkCopied, setIsShareLinkCopied] = useState(false)
  const [submission, setSubmission] = useState<SubmissionResponse | null>(null)
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchSubmissionDetail = useCallback(async () => {
    const loadedSubmission = await getSubmission(submissionId, "fields")
    const templateDocuments = loadedSubmission.template
      ? (await getTemplate(loadedSubmission.template.id)).documents
      : []
    const generatedDocuments = normalizeSubmissionDocuments(
      loadedSubmission.documents ?? [],
    )
    const documents =
      loadedSubmission.status === "completed" && generatedDocuments.length
        ? generatedDocuments
        : normalizeTemplateDocuments(templateDocuments)

    return { documents, loadedSubmission }
  }, [submissionId])

  const refreshSubmissionDetail = useCallback(async () => {
    try {
      const { documents: loadedDocuments, loadedSubmission } =
        await fetchSubmissionDetail()

      setSubmission(loadedSubmission)
      setDocuments(loadedDocuments)

      if (isEventsOpen) {
        const [submissionEvents, submissionMailEvents] = await Promise.all([
          getSubmissionEvents(submissionId),
          getSubmissionMailEvents(submissionId),
        ])

        setEvents(submissionEvents.data)
        setMailEvents(submissionMailEvents.data)
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.push("/auth/login")
      }
    }
  }, [fetchSubmissionDetail, isEventsOpen, router, submissionId])

  useRealtimeEvents({
    enabled: Boolean(submission),
    onEvent: () => {
      void refreshSubmissionDetail()
    },
    scope: "submission",
    submissionId,
  })

  useEffect(() => {
    let isCancelled = false

    async function loadInitialSubmissionDetail() {
      try {
        const { documents: loadedDocuments, loadedSubmission } =
          await fetchSubmissionDetail()

        if (isCancelled) {
          return
        }

        setSubmission(loadedSubmission)
        setDocuments(loadedDocuments)
      } catch (error) {
        if (isCancelled) {
          return
        }

        if (error instanceof ApiError && error.status === 401) {
          router.push("/auth/login")
          return
        }

        toast.error("Submission could not be loaded", {
          description: error instanceof Error ? error.message : "Try again.",
        })
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadInitialSubmissionDetail()

    return () => {
      isCancelled = true
    }
  }, [fetchSubmissionDetail, router])

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current)
      }
    }
  }, [])

  async function openEventLog() {
    setIsEventsOpen(true)
    setIsEventsLoading(true)

    try {
      const [response, mailResponse] = await Promise.all([
        getSubmissionEvents(submissionId),
        getSubmissionMailEvents(submissionId),
      ])

      setEvents(response.data)
      setMailEvents(mailResponse.data)
    } catch (error) {
      toast.error("Event log could not be loaded", {
        description: error instanceof Error ? error.message : "Try again.",
      })
    } finally {
      setIsEventsLoading(false)
    }
  }

  async function copyShareLink() {
    const submitter = submission?.submitters[0]

    if (!submitter?.slug) {
      toast.info("No signer link is available for this submission.")
      return
    }

    await navigator.clipboard.writeText(`${window.location.origin}/s/${submitter.slug}`)
    setIsShareLinkCopied(true)

    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current)
    }

    copyResetTimeoutRef.current = setTimeout(() => {
      setIsShareLinkCopied(false)
      copyResetTimeoutRef.current = null
    }, 1800)

    toast.success("Share link copied")
  }

  async function downloadDocuments() {
    setIsDownloading(true)

    try {
      const response = await getSubmissionDocuments(submissionId)

      response.documents.forEach((document) => {
        const link = window.document.createElement("a")
        link.href = document.url
        link.target = "_blank"
        link.rel = "noreferrer"
        link.download = document.name
        link.click()
      })
    } catch (error) {
      toast.error("Download failed", {
        description: error instanceof Error ? error.message : "Try again.",
      })
    } finally {
      setIsDownloading(false)
    }
  }

  const fields = useMemo(
    () => [...(submission?.fields ?? [])].sort(compareFieldsByDocumentPosition),
    [submission?.fields],
  )

  if (isLoading) {
    return <SubmissionDetailLoading />
  }

  if (!submission) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-[var(--auth-background)]" id="main-content" tabIndex={-1}>
        <p className="text-sm font-semibold text-[var(--auth-muted-foreground)]">
          Submission not found.
        </p>
      </main>
    )
  }

  const title = submission.name ?? submission.template?.name ?? "Submission"

  return (
    <main
      className="min-h-svh overflow-x-hidden bg-[var(--auth-background)] text-[var(--auth-foreground)]"
      id="main-content"
      tabIndex={-1}
    >
      <div className="mx-auto flex w-full max-w-[1600px] flex-col px-4 py-1.5">
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 bg-[var(--auth-background)]/95 py-1.5 backdrop-blur">
          <Link
            className="flex min-w-0 flex-1 items-center gap-3"
            href={submission.template ? `/templates/${submission.template.id}` : "/templates"}
          >
            <BrandLogo className="max-w-44 sm:max-w-64" />
            <h1 className="truncate text-xl font-semibold md:text-3xl">{title}</h1>
          </Link>
          <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center sm:gap-3">
            <Button
              aria-label="Open event log"
              className="size-11 rounded-full p-0 text-sm font-bold sm:h-11 sm:w-auto sm:px-5"
              onClick={() => void openEventLog()}
              type="button"
              variant="outline"
            >
              <ListIcon data-icon="inline-start" />
              <span className="hidden sm:inline">EVENT LOG</span>
            </Button>
            <Button
              aria-label={
                isShareLinkCopied ? "Copied to clipboard" : "Copy share link"
              }
              className="size-11 rounded-full p-0 text-sm font-bold sm:h-11 sm:w-auto sm:px-5"
              onClick={() => void copyShareLink()}
              type="button"
            >
              <CopyIcon data-icon="inline-start" />
              <span className="hidden sm:inline">
                {isShareLinkCopied ? "COPIED TO CLIPBOARD" : "COPY SHARE LINK"}
              </span>
            </Button>
            <Button
              aria-label="Download"
              className="size-11 rounded-full p-0 sm:h-11 sm:w-auto sm:px-5"
              disabled={isDownloading}
              onClick={() => void downloadDocuments()}
              type="button"
            >
              {isDownloading ? <Spinner /> : <DownloadIcon />}
              <span className="hidden sm:inline">DOWNLOAD</span>
            </Button>
          </div>
        </header>

        <section className="flex max-h-[calc(100svh-92px)] min-h-[calc(100svh-92px)] overflow-hidden sm:max-h-[calc(100svh-60px)] sm:min-h-[calc(100svh-60px)]">
          <SubmissionDocumentThumbnails documents={documents} title={title} />
          <SubmissionDocumentPreview
            documents={documents}
            fields={fields}
            showFieldOverlays={submission.status !== "completed"}
            submission={submission}
            title={title}
          />
          <SubmissionPartiesPanel fields={fields} submission={submission} />
        </section>
      </div>

      <SubmissionEventLogDialog
        auditLogUrl={submission.audit_log_url}
        combinedDocumentUrl={submission.combined_document_url}
        events={events}
        isLoading={isEventsLoading}
        mailEvents={mailEvents}
        onOpenChange={setIsEventsOpen}
        open={isEventsOpen}
      />
    </main>
  )
}

function normalizeTemplateDocuments(
  documents: TemplateDocument[],
): SubmissionPreviewDocument[] {
  return documents
    .filter((document) => document.preview_images.length > 0)
    .map((document) => ({
      id: document.id,
      uuid: document.uuid,
      filename: document.filename,
      name: getDocumentName(document.filename),
      url: document.url,
      preview_images: document.preview_images,
    }))
}

function getDocumentName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "")
}

function normalizeSubmissionDocuments(
  documents: SubmissionDocumentResponse[],
): SubmissionPreviewDocument[] {
  return documents
    .filter((document) => (document.preview_images?.length ?? 0) > 0)
    .map((document, index) => ({
      id: document.id ?? String(index),
      uuid: document.uuid ?? document.id ?? `document-${index}`,
      filename: document.filename ?? `${document.name}.pdf`,
      name: document.name,
      url: document.url,
      preview_images: document.preview_images ?? [],
    }))
}

function SubmissionDetailLoading() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-[var(--auth-background)] text-[var(--auth-foreground)]" id="main-content" tabIndex={-1}>
      <div className="flex items-center gap-3 text-sm font-semibold">
        <Spinner />
        Loading submission
      </div>
    </main>
  )
}
