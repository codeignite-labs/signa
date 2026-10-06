"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  completeSocialAuth,
  getSocialAuthStateKey,
  saveAuthSession,
  type SocialAuthProvider,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/api/http";

const supportedProviders = new Set<SocialAuthProvider>([
  "google",
]);

export default function OAuthCallbackPage() {
  const params = useParams<{ provider: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const provider = useMemo<SocialAuthProvider | null>(() => {
    return supportedProviders.has(params.provider as SocialAuthProvider)
      ? (params.provider as SocialAuthProvider)
      : null;
  }, [params.provider]);
  const callbackStarted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const initialError = useMemo(() => {
    if (!provider) {
      return "Unsupported sign-in provider.";
    }

    return (
      searchParams.get("error_description") ?? searchParams.get("error")
    );
  }, [provider, searchParams]);

  useEffect(() => {
    if (!provider || initialError || callbackStarted.current) {
      return;
    }

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const expectedState = window.sessionStorage.getItem(
      getSocialAuthStateKey(provider),
    );

    if (!code || !state || !expectedState || state !== expectedState) {
      queueMicrotask(() => {
        setError("The sign-in response could not be verified. Please try again.");
      });
      return;
    }

    callbackStarted.current = true;
    window.sessionStorage.removeItem(getSocialAuthStateKey(provider));

    completeSocialAuth(provider, { code, state })
      .then((session) => {
        saveAuthSession(session);
        router.replace("/templates");
      })
      .catch((callbackError: unknown) => {
        setError(
          callbackError instanceof ApiError
            ? callbackError.message
            : "Social sign-in failed. Please try again.",
        );
      });
  }, [initialError, provider, router, searchParams]);

  const displayError = initialError ?? error;

  if (displayError) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-[var(--auth-background)] px-5 text-[var(--auth-foreground)]" id="main-content" tabIndex={-1}>
        <section className="w-full max-w-md rounded-3xl border border-[var(--auth-input-border)] bg-card p-6 text-center shadow-xl">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <TriangleAlertIcon className="size-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold">Sign-in failed</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--auth-label)]">
            {displayError}
          </p>
          <Button
            asChild
            className="mt-6 h-11 rounded-full bg-[var(--auth-primary)] px-6 font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
          >
            <Link href="/auth/login">Back to sign in</Link>
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-[var(--auth-background)] px-5 text-[var(--auth-foreground)]" id="main-content" tabIndex={-1}>
      <section className="flex items-center gap-3 rounded-full border border-[var(--auth-input-border)] bg-card px-5 py-3 text-sm font-bold shadow-sm">
        <Loader2Icon className="size-4 animate-spin" />
        Completing secure sign-in...
      </section>
    </main>
  );
}
