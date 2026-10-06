"use client";

import { useEffect, useLayoutEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AccountBranding } from "@repo/shared/branding";
import {
  brandingCacheConfig,
  readBrandingSnapshot,
  rememberBranding,
} from "@/lib/branding/branding-cache";

export function useBrandingPersistence({
  accountId,
  branding,
  updatedAt,
  resolved,
}: {
  accountId: string | null;
  branding: AccountBranding | null | undefined;
  updatedAt: number;
  resolved: boolean;
}) {
  const client = useQueryClient();
  useLayoutEffect(() => {
    if (accountId && branding) rememberBranding(accountId, branding, updatedAt);
    // The React-owned style is now committed; remove the pre-paint fallback.
    if (resolved) document.getElementById("signa-branding-bootstrap")?.remove();
  }, [accountId, branding, updatedAt, resolved]);

  useEffect(() => {
    function sync(event: StorageEvent) {
      if (!accountId || event.key !== brandingCacheConfig.prefix + accountId)
        return;
      const snapshot = readBrandingSnapshot(accountId);
      if (snapshot)
        client.setQueryData(
          ["account-branding", accountId],
          snapshot.branding,
          { updatedAt: snapshot.updatedAt },
        );
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [accountId, client]);
}
