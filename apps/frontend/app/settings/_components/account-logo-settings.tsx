"use client";

import { useRef, useState } from "react";
import { UploadCloudIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { AccountBranding } from "@repo/shared/branding";
import { BrandLogo } from "@/components/branding/brand-logo";
import { Button } from "@/components/ui/button";
import { deleteAccountLogo, uploadAccountLogo } from "@/lib/api/auth";

export function AccountLogoSettings({
  branding,
  refresh,
}: {
  branding: AccountBranding;
  refresh: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, changeLogo } = useAccountLogoUpload(refresh);
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Account logo</h3>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <BrandLogo branding={branding} className="max-w-full" />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <UploadCloudIcon data-icon="inline-start" />
            {busy
              ? "Updating…"
              : branding.logo
                ? "Replace logo"
                : "Upload logo"}
          </Button>
          {branding.logo && (
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Remove account logo"
              disabled={busy}
              onClick={() => void changeLogo()}
            >
              <Trash2Icon />
            </Button>
          )}
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        PNG, JPEG or WebP · up to 2 MB. Transparency is preserved. Check your
        logo in both previews below.
      </p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Account logo file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void changeLogo(file);
        }}
      />
    </div>
  );
}

function useAccountLogoUpload(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  async function changeLogo(file?: File) {
    if (file && file.size > 2 * 1024 * 1024) {
      toast.error("Choose a logo smaller than 2 MB");
      return;
    }
    setBusy(true);
    try {
      if (file) await uploadAccountLogo(file);
      else await deleteAccountLogo();
      await refresh();
      toast.success(file ? "Account logo uploaded" : "Account logo removed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Logo could not be updated",
      );
    } finally {
      setBusy(false);
    }
  }
  return { busy, changeLogo };
}
