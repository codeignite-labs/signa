import type { AccountBranding } from "@repo/shared/branding";

export function BrandAttribution({
  branding,
}: {
  branding?: AccountBranding | null;
}) {
  if (branding?.white_label) return null;
  return (
    <p className="mt-4 text-center text-sm text-muted-foreground">
      Powered by <span className="font-semibold text-primary">Signa</span> —
      open source documents software
    </p>
  );
}
