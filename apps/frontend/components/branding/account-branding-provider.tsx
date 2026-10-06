"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { AccountBranding } from "@repo/shared/branding";
import { getAuthSession, subscribeToAuthSessionChange } from "@/lib/api/auth";
import { getAccountBranding } from "@/lib/api/branding";
import { readBrandingSnapshot } from "@/lib/branding/branding-cache";
import { useBrandingPersistence } from "./use-branding-persistence";
import { BrandStyle } from "./brand-style";

const neutralBranding: AccountBranding = {
  account_name: "",
  primary_color: "#737373",
  white_label: false,
  logo: null,
};
const BrandingContext = createContext<AccountBranding | null | undefined>(
  undefined,
);
const accountSnapshot = () => getAuthSession()?.account.id ?? null;
const serverSnapshot = () => null;

export function useAccountBrandingQuery() {
  const accountId = useSyncExternalStore(
    subscribeToAuthSessionChange,
    accountSnapshot,
    serverSnapshot,
  );
  const pathname = usePathname();
  const publicRoute = /^\/(s|d|auth)(\/|$)/.test(pathname) || pathname === "/";
  const snapshot = useMemo(
    () => (accountId && !publicRoute ? readBrandingSnapshot(accountId) : null),
    [accountId, publicRoute],
  );
  const query = useQuery({
    queryKey: ["account-branding", accountId],
    queryFn: getAccountBranding,
    enabled: Boolean(accountId) && !publicRoute,
    select: (data) => (accountId && !publicRoute ? data : null),
    initialData: snapshot?.branding,
    initialDataUpdatedAt: snapshot?.updatedAt,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return { query, accountId, publicRoute };
}

export function AccountBrandingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { query, accountId, publicRoute } = useAccountBrandingQuery();
  const { refetch } = query;
  useEffect(() => {
    // A freshly persisted snapshot still needs an authoritative read on entry.
    if (accountId && !publicRoute) void refetch({ cancelRefetch: false });
  }, [accountId, publicRoute, refetch]);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const pending =
    !publicRoute && (!hydrated || Boolean(accountId && query.isPending));
  const branding = publicRoute
    ? null
    : (query.data ?? (pending ? undefined : null));
  useBrandingPersistence({
    accountId: publicRoute ? null : accountId,
    branding,
    updatedAt: query.dataUpdatedAt,
    resolved: hydrated && !pending,
  });
  return (
    <BrandingContext value={branding}>
      <BrandStyle branding={hydrated && pending ? neutralBranding : branding} />
      {children}
    </BrandingContext>
  );
}

const subscribeToHydration = () => () => undefined;

export function useAccountBranding() {
  const branding = useContext(BrandingContext);
  // Suspense children can hydrate after the provider has already loaded its cache.
  // Each consumer must still match its own server-rendered placeholder first.
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  return hydrated ? branding : undefined;
}
