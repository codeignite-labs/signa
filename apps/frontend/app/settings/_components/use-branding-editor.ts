"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  normalizeBrandColor,
  type AccountBranding,
} from "@repo/shared/branding";
import { updateAccountBranding } from "@/lib/api/branding";

export function useBrandingEditor(
  branding: AccountBranding,
  refresh: () => Promise<void>,
) {
  const [color, setColor] = useState(branding.primary_color ?? "");
  const [whiteLabel, setWhiteLabel] = useState(branding.white_label);
  const [showBusinessName, setShowBusinessName] = useState(
    branding.show_business_name !== false,
  );
  const [busy, setBusy] = useState(false);
  const normalized = color.trim() ? normalizeBrandColor(color) : null;
  const invalid = Boolean(color.trim() && !normalized);
  const dirty =
    normalized !== branding.primary_color ||
    whiteLabel !== branding.white_label ||
    showBusinessName !== (branding.show_business_name !== false);
  const preview = {
    ...branding,
    primary_color: normalized,
    white_label: whiteLabel,
    show_business_name: showBusinessName,
  };

  async function save() {
    setBusy(true);
    try {
      await updateAccountBranding({
        primary_color: normalized,
        white_label: whiteLabel,
        show_business_name: showBusinessName,
      });
      await refresh();
      toast.success("Account branding saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Branding could not be saved",
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    color,
    setColor,
    whiteLabel,
    setWhiteLabel,
    showBusinessName,
    setShowBusinessName,
    busy,
    normalized,
    invalid,
    dirty,
    preview,
    save,
  };
}
