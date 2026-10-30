// @vitest-environment node
import React from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SignaturePanel } from "../../../apps/frontend/app/s/[slug]/signature-panel";
import { signingForm } from "./signing-fixtures";
import type { SigningField } from "../../../apps/frontend/lib/api/signing";
function serverMarkup(field?: SigningField) {
  const form = signingForm({ fields: field ? [field] : [] });
  return renderToString(
    <SignaturePanel
      activeField={field}
      fields={form.fields}
      form={form}
      onFormChange={() => undefined}
      onComplete={async () => undefined}
      onSaveField={async () => undefined}
      onSelectField={() => undefined}
      onUploadAttachment={async () => "unused"}
    />,
  );
}
it("server-renders an empty signing panel without browser globals", () => {
  expect(serverMarkup()).toBe("");
});
it("server-renders text and signature controls while deferring the browser-only canvas", () => {
  expect(serverMarkup({ type: "text", name: "Legal name" })).toContain(
    'placeholder="Legal name"',
  );
  const signature = serverMarkup({
    type: "signature",
    uuid: "signature",
    name: "Signature",
  });
  expect(signature).toContain("Signature");
  expect(signature).not.toContain("canvas aria-label");
});
it("uses a deterministic country fallback when server Intl data is unavailable", () => {
  vi.stubGlobal("Intl", undefined);
  const phone = serverMarkup({ type: "phone", uuid: "phone" });
  expect(phone).toContain("Select phone country");
  expect(phone.replaceAll("<!-- -->", "")).toContain("+1");
});
