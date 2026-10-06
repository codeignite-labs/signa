"use client"

import { useState } from "react"
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { NuqsAdapter } from "nuqs/adapters/next/app"

import { AuthRouteGuard } from "./auth-route-guard"
import { AccountBrandingProvider } from "@/components/branding/account-branding-provider"
import { TestModeAlert } from "./test-mode-alert"

type ProvidersProps = {
  children: React.ReactNode
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            if (process.env.NODE_ENV === "development") {
              console.error(error)
            }
          },
        }),
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 30_000,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  )

  return (
    <NuqsAdapter>
      <QueryClientProvider client={queryClient}>
        <AccountBrandingProvider>
          <AuthRouteGuard>{children}</AuthRouteGuard>
        </AccountBrandingProvider>
        <TestModeAlert />
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </NuqsAdapter>
  )
}
