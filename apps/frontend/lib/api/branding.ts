import type { AccountBranding } from "@repo/shared/branding";
import { authenticatedApiFetch } from "./auth";

export function getAccountBranding(): Promise<AccountBranding> {
  return authenticatedApiFetch("/account/branding");
}

export function updateAccountBranding(
  input: Pick<
    AccountBranding,
    "primary_color" | "white_label" | "show_business_name"
  >,
): Promise<AccountBranding> {
  return authenticatedApiFetch("/account/branding", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
