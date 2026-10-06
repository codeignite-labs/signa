"use client";

import Image from "next/image";
import { useState } from "react";
import type { AccountBranding } from "@repo/shared/branding";
import { cn } from "@/lib/utils";
import { useAccountBranding } from "./account-branding-provider";

export function BrandLogo({
  branding,
  className,
}: {
  branding?: AccountBranding | null;
  className?: string;
}) {
  const account = useAccountBranding();
  const brand = branding === undefined ? account : branding;
  if (brand === undefined) {
    return (
      <span
        data-brand-placeholder
        aria-hidden="true"
        className={cn(
          "inline-block h-10 w-24 max-w-full sm:h-12 sm:w-32",
          className,
        )}
      />
    );
  }
  return (
    <LogoImage
      key={brand?.logo?.url ?? brand?.account_name ?? "Signa"}
      brand={brand}
      className={className}
    />
  );
}

function LogoImage({
  brand,
  className,
}: {
  brand: AccountBranding | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const label = brand?.account_name || "Signa";
  const showName =
    Boolean(brand?.account_name) && brand?.show_business_name !== false;
  if ((brand?.white_label && !brand.logo) || failed) {
    return (
      <span
        className={cn(
          "line-clamp-2 max-w-full break-words text-lg font-bold leading-tight",
          className,
        )}
      >
        {label}
      </span>
    );
  }
  return (
    <span
      data-brand-logo
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-3",
        className,
      )}
    >
      <Image
        alt={showName ? "" : label}
        src={brand?.logo?.url ?? "/images/logo.png"}
        width={160}
        height={64}
        unoptimized={Boolean(brand?.logo)}
        data-platform-logo={!brand?.logo || undefined}
        loading="eager"
        onError={() => setFailed(true)}
        className="h-10 w-auto max-w-24 shrink-0 object-contain sm:h-12 sm:max-w-32"
      />
      {showName && (
        <span
          data-brand-name
          title={label}
          translate="no"
          className="line-clamp-2 min-w-0 break-words text-sm font-semibold leading-tight text-foreground sm:text-base"
        >
          {label}
        </span>
      )}
    </span>
  );
}
