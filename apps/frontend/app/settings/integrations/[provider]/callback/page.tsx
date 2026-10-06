"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import {
  type AccountEmailIntegrationProvider,
  completeAccountEmailIntegration,
} from "@/lib/api/auth"

const providers = new Set<AccountEmailIntegrationProvider>([
  "gmail",
])

export default function IntegrationCallbackPage({
  params,
}: {
  params: { provider: string }
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [message, setMessage] = useState("Completing integration...")
  const provider = useMemo(
    () =>
      providers.has(params.provider as AccountEmailIntegrationProvider)
        ? (params.provider as AccountEmailIntegrationProvider)
        : null,
    [params.provider]
  )

  useEffect(() => {
    const code = searchParams.get("code")
    const state = searchParams.get("state")
    const error = searchParams.get("error")

    if (!provider) {
      return
    }

    if (error) {
      toast.error("Integration was not connected", {
        description: error,
      })
      router.replace("/settings/integrations")
      return
    }

    if (!code) {
      toast.error("Missing authorization code")
      router.replace("/settings/integrations")
      return
    }

    completeAccountEmailIntegration(provider, { code, state })
      .then((integration) => {
        toast.success(`${integration.name} connected`)
        router.replace("/settings/integrations")
      })
      .catch((callbackError: unknown) => {
        setMessage("Integration could not be connected.")
        toast.error("Integration could not be connected", {
          description: getErrorMessage(callbackError),
        })
        router.replace("/settings/integrations")
      })
  }, [provider, router, searchParams])

  return (
    <main className="flex min-h-svh items-center justify-center bg-[var(--auth-background)] px-5 text-[var(--auth-foreground)]" id="main-content" tabIndex={-1}>
      <div className="flex items-center gap-3 rounded-2xl bg-[var(--auth-muted)] px-5 py-4 text-base font-bold">
        <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
        {message}
      </div>
    </main>
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Please try again."
}
