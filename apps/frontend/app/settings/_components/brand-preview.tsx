"use client";

import type { CSSProperties } from "react";
import {
  brandPalette,
  contrastRatio,
  defaultBrandColor,
  type AccountBranding,
} from "@repo/shared/branding";
import { BrandLogo } from "@/components/branding/brand-logo";
import { BrandAttribution } from "@/components/branding/brand-attribution";
import {
  Card,
  CardHeader,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

export function BrandPreview({ branding }: { branding: AccountBranding }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-label="Brand preview">
      {[false, true].map((dark) => {
        const palette = brandPalette(
          branding.primary_color ?? defaultBrandColor,
          dark,
        );
        const ratio = contrastRatio(
          palette["--primary"],
          palette["--primary-foreground"],
        );
        return (
          <Card key={String(dark)} style={palette as CSSProperties}>
            <CardHeader>
              <CardDescription>
                {dark ? "Dark" : "Light"} preview
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-5">
              <BrandLogo branding={branding} className="max-w-full" />
              <div>
                <p className="font-semibold">Ready for your signature</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Review and sign your document.
                </p>
              </div>
              <span className="rounded-lg bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground">
                Review document
              </span>
              <p className="text-xs tabular-nums text-muted-foreground">
                Button text contrast: {ratio.toFixed(2)}:1
              </p>
            </CardContent>
            {!branding.white_label && (
              <CardFooter>
                <BrandAttribution branding={branding} />
              </CardFooter>
            )}
          </Card>
        );
      })}
    </div>
  );
}
