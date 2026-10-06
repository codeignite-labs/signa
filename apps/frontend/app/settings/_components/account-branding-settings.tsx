"use client";

import { defaultBrandColor, type AccountBranding } from "@repo/shared/branding";
import { useAccountBrandingQuery } from "@/components/branding/account-branding-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useBrandingEditor } from "./use-branding-editor";
import { AccountLogoSettings } from "./account-logo-settings";
import { BrandPreview } from "./brand-preview";

export function AccountBrandingSettings() {
  const { query, accountId } = useAccountBrandingQuery();
  if (query.isError)
    return (
      <div role="alert" className="my-6">
        Branding could not be loaded.{" "}
        <Button variant="outline" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  if (!query.data)
    return <p className="my-6 text-muted-foreground">Loading branding…</p>;
  return (
    <BrandingEditor
      key={`${accountId}-${query.data.primary_color}-${query.data.white_label}-${query.data.show_business_name}`}
      branding={query.data}
      refresh={async () => {
        await query.refetch();
      }}
    />
  );
}

function BrandingEditor({
  branding,
  refresh,
}: {
  branding: AccountBranding;
  refresh: () => Promise<void>;
}) {
  const {
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
  } = useBrandingEditor(branding, refresh);

  return (
    <section
      className="mt-6 flex flex-col gap-6"
      aria-labelledby="branding-heading"
    >
      <div>
        <h2 id="branding-heading" className="text-2xl font-bold">
          Your brand, throughout
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Make the workspace, signing pages and emails feel like your
          organization.
        </p>
      </div>
      <AccountLogoSettings branding={branding} refresh={refresh} />
      <Separator />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalid && dirty) void save();
        }}
      >
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-6">
          <FieldGroup>
            <Field data-invalid={invalid}>
              <FieldLabel htmlFor="brand-color">Primary color</FieldLabel>
              <div className="flex items-center gap-3">
                <input
                  aria-label="Choose primary color"
                  type="color"
                  value={normalized ?? defaultBrandColor}
                  onChange={(event) => setColor(event.target.value)}
                  className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-input bg-card p-1"
                />
                <Input
                  id="brand-color"
                  name="primary_color"
                  aria-invalid={invalid}
                  aria-describedby="brand-color-help"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  placeholder="Default theme"
                  maxLength={7}
                  className="h-11 font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setColor("")}
                  disabled={!color}
                >
                  Reset
                </Button>
              </div>
              <FieldDescription id="brand-color-help">
                {invalid
                  ? "Enter a hex color such as #27639D."
                  : "Enter a hex color. We adjust UI shades for readable text and controls in both themes."}
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <div className="flex-1">
                <FieldLabel htmlFor="show-business-name">
                  Show business title
                </FieldLabel>
                <FieldDescription>
                  Display your account name beside the logo in the app, signing
                  pages and emails. Edit the name in Account settings.
                </FieldDescription>
              </div>
              <Switch
                id="show-business-name"
                checked={showBusinessName}
                onCheckedChange={setShowBusinessName}
              />
            </Field>
            <Field orientation="horizontal">
              <div className="flex-1">
                <FieldLabel htmlFor="white-label">
                  White-label experience
                </FieldLabel>
                <FieldDescription>
                  Hide “Powered by Signa” on signing pages and emails. Your
                  account name appears when no logo is uploaded.
                </FieldDescription>
              </div>
              <Switch
                id="white-label"
                checked={whiteLabel}
                onCheckedChange={setWhiteLabel}
              />
            </Field>
          </FieldGroup>
          <BrandPreview branding={preview} />
          <Button
            type="submit"
            className="h-11 self-start px-6"
            disabled={busy || invalid || !dirty}
          >
            {busy ? "Saving…" : "Save branding"}
          </Button>
        </fieldset>
      </form>
    </section>
  );
}
