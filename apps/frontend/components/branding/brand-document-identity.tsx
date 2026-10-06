"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { AccountBranding } from "@repo/shared/branding";

const neutralIcon =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="6" y="3" width="20" height="26" rx="3" fill="#ffffff" stroke="#171717" stroke-width="2"/><path d="M11 11h10M11 16h10M11 21h6" stroke="#171717" stroke-width="2"/></svg>',
  );

export function BrandDocumentIdentity({
  branding,
}: {
  branding?: AccountBranding | null;
}) {
  const pathname = usePathname();
  useEffect(() => {
    if (!branding?.white_label) return;
    const previousTitle = document.title;
    document.title = branding.account_name;
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.href = neutralIcon;
    document.head.append(icon);
    return () => {
      document.title = previousTitle;
      icon.remove();
    };
  }, [branding, pathname]);
  return null;
}
