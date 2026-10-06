"use client"

import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  type AccountEmailIntegration,
  type AccountEmailIntegrationProvider,
  connectAccountEmailIntegration,
  disconnectAccountEmailIntegration,
  listAccountEmailIntegrations,
} from "@/lib/api/auth"
import { SettingsSidebar } from "./settings-sidebar"

type IntegrationProvider = {
  accentClassName: string
  description: string
  icon: React.ReactNode
  provider: AccountEmailIntegrationProvider
  title: string
}

const emailIntegrations: IntegrationProvider[] = [
  {
    accentClassName: "border-[#4285f4] text-[var(--auth-foreground)]",
    description:
      "Send signature requests to your recipients directly from your Gmail account.",
    icon: <GoogleIcon />,
    provider: "gmail",
    title: "Connect Gmail",
  },

]

export function IntegrationsSettingsBody() {
  const [integrations, setIntegrations] = useState<AccountEmailIntegration[]>([])
  const [pendingProvider, setPendingProvider] =
    useState<AccountEmailIntegrationProvider | null>(null)
  const integrationByProvider = useMemo(
    () =>
      new Map(
        integrations.map((integration) => [integration.provider, integration])
      ),
    [integrations]
  )

  useEffect(() => {
    listAccountEmailIntegrations()
      .then(setIntegrations)
      .catch((error: unknown) =>
        toast.error("Integrations could not be loaded", {
          description: getErrorMessage(error),
        })
      )
  }, [])

  async function connect(provider: AccountEmailIntegrationProvider) {
    setPendingProvider(provider)

    try {
      const response = await connectAccountEmailIntegration(provider)

      if (!response.configured || !response.url) {
        toast.error("Integration is not configured", {
          description: "Add the OAuth client ID and redirect URI in the backend env.",
        })
        return
      }

      window.location.assign(response.url)
    } catch (error) {
      toast.error("Integration connection failed", {
        description: getErrorMessage(error),
      })
    } finally {
      setPendingProvider(null)
    }
  }

  async function disconnect(provider: AccountEmailIntegrationProvider) {
    setPendingProvider(provider)

    try {
      const integration = await disconnectAccountEmailIntegration(provider)

      setIntegrations((current) =>
        current.map((item) =>
          item.provider === integration.provider ? integration : item
        )
      )
      toast.success(`${integration.name} disconnected`)
    } catch (error) {
      toast.error("Integration disconnect failed", {
        description: getErrorMessage(error),
      })
    } finally {
      setPendingProvider(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-8 md:flex-nowrap">
      <SettingsSidebar active="Integrations" />
      <section className="w-full max-w-xl flex-1 pb-12">
        <h1 className="text-4xl font-bold tracking-normal">Integrations</h1>

        <div className="mt-8">
          <div className="mb-5">
            <h2 className="text-2xl font-bold tracking-normal">
              Email Integration
            </h2>
            <p className="mt-2 text-base">
              Send signature request to your recipients directly from your email
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {emailIntegrations.map((integration) => (
              <IntegrationButton
                integration={integration}
                isPending={pendingProvider === integration.provider}
                key={integration.title}
                onConnect={() => void connect(integration.provider)}
                onDisconnect={() => void disconnect(integration.provider)}
                status={integrationByProvider.get(integration.provider)}
              />
            ))}
          </div>
        </div>
      </section>
      <div className="hidden w-52 shrink-0 md:block" />
    </div>
  )
}

function IntegrationButton({
  integration,
  isPending,
  onConnect,
  onDisconnect,
  status,
}: {
  integration: IntegrationProvider
  isPending: boolean
  onConnect: () => void
  onDisconnect: () => void
  status?: AccountEmailIntegration
}) {
  const title = status?.connected
    ? integration.title.replace("Connect", "Re-connect")
    : integration.title

  return (
    <div className="flex flex-col gap-2">
      <Button
        className={`h-12 rounded-full border-2 bg-transparent text-sm font-bold uppercase hover:bg-[var(--auth-muted)] ${integration.accentClassName}`}
        disabled={isPending}
        onClick={onConnect}
        type="button"
        variant="outline"
      >
        {integration.icon}
        {isPending ? "Opening..." : title}
      </Button>
      {status?.connected ? (
        <div className="flex items-center justify-between gap-3 px-3 text-sm text-muted-foreground">
          <span>{status.email ?? `${status.name} connected`}</span>
          <button
            className="font-bold text-[var(--auth-primary)] hover:underline"
            disabled={isPending}
            onClick={onDisconnect}
            type="button"
          >
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-5"
      fill="none"
      viewBox="-0.5 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M9.82727273,24 C9.82727273,22.4757333 10.0804318,21.0144 10.5322727,19.6437333 L2.62345455,13.6042667 C1.08206818,16.7338667 0.213636364,20.2602667 0.213636364,24 C0.213636364,27.7365333 1.081,31.2608 2.62025,34.3882667 L10.5247955,28.3370667 C10.0772273,26.9728 9.82727273,25.5168 9.82727273,24" fill="#FBBC05" />
      <path d="M23.7136364,10.1333333 C27.025,10.1333333 30.0159091,11.3066667 32.3659091,13.2266667 L39.2022727,6.4 C35.0363636,2.77333333 29.6954545,0.533333333 23.7136364,0.533333333 C14.4268636,0.533333333 6.44540909,5.84426667 2.62345455,13.6042667 L10.5322727,19.6437333 C12.3545909,14.112 17.5491591,10.1333333 23.7136364,10.1333333" fill="#EB4335" />
      <path d="M23.7136364,37.8666667 C17.5491591,37.8666667 12.3545909,33.888 10.5322727,28.3562667 L2.62345455,34.3946667 C6.44540909,42.1557333 14.4268636,47.4666667 23.7136364,47.4666667 C29.4455,47.4666667 34.9177955,45.4314667 39.0249545,41.6181333 L31.5177727,35.8144 C29.3995682,37.1488 26.7323182,37.8666667 23.7136364,37.8666667" fill="#34A853" />
      <path d="M46.1454545,24 C46.1454545,22.6133333 45.9318182,21.12 45.6113636,19.7333333 L23.7136364,19.7333333 L23.7136364,28.8 L36.3181818,28.8 C35.6879545,31.8912 33.9724545,34.2677333 31.5177727,35.8144 L39.0249545,41.6181333 C43.3393409,37.6138667 46.1454545,31.6490667 46.1454545,24" fill="#4285F4" />
    </svg>
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Please try again."
}
