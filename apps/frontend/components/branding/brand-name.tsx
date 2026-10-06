"use client";

import { useAccountBranding } from "./account-branding-provider";

export function BrandName() {
  const branding = useAccountBranding();
  if (branding === undefined) return null;
  return branding?.white_label ? branding.account_name : "Signa";
}
