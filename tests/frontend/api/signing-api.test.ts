import { beforeEach, expect, it, vi } from "vitest";
import * as signing from "../../../apps/frontend/lib/api/signing";
import * as start from "../../../apps/frontend/lib/api/start-form";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
});
it("loads public signing data and encodes tracking/field cursors without query injection", async () => {
  await signing.getSigningForm("slug");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/signing/slug");
  await signing.getSigningForm("slug", "track&other=bad");
  expect(fetchMock.mock.calls[1][0]).toBe(
    "/api/signing/slug?t=track%26other%3Dbad",
  );
  await signing.getSigningFieldValue("slug", "field&extra");
  expect(fetchMock.mock.calls[2][0]).toBe(
    "/api/signing/slug/values?field_uuid=field%26extra",
  );
  await signing.getSigningFieldValue("slug", "field", "after&next");
  expect(fetchMock.mock.calls[3][0]).toBe(
    "/api/signing/slug/values?field_uuid=field&after=after%26next",
  );
});
const cases: Array<[string, () => Promise<unknown>, string, string, unknown?]> =
  [
    [
      "save values",
      () => signing.updateSigningValues("slug", { field: "value" }),
      "/signing/slug/values",
      "PUT",
      { values: { field: "value" } },
    ],
    [
      "complete",
      () => signing.completeSigningForm("slug", { field: "value" }),
      "/signing/slug/complete",
      "POST",
      { values: { field: "value" } },
    ],
    [
      "decline default",
      () => signing.declineSigningForm("slug"),
      "/signing/slug/decline",
      "POST",
      { reason: "" },
    ],
    [
      "decline reason",
      () => signing.declineSigningForm("slug", "No"),
      "/signing/slug/decline",
      "POST",
      { reason: "No" },
    ],
    [
      "resubmit",
      () => signing.resubmitSigningForm("slug"),
      "/signing/slug/resubmit",
      "POST",
    ],
    [
      "send phone verification",
      () =>
        signing.sendSigningPhoneVerification("slug", { phone: "+15551234567" }),
      "/signing/slug/phone-verification/send",
      "POST",
      { phone: "+15551234567" },
    ],
    [
      "validate phone",
      () => signing.validateSigningPhoneNumber("slug", { field_uuid: "field" }),
      "/signing/slug/phone-verification/validate",
      "POST",
      { field_uuid: "field" },
    ],
    [
      "verify code",
      () => signing.verifySigningPhoneCode("slug", { code: "123456" }),
      "/signing/slug/phone-verification/check",
      "POST",
      { code: "123456" },
    ],
    [
      "download",
      () => signing.getSigningDownload("slug"),
      "/signing/slug/download",
      "GET",
    ],
    [
      "completed copy",
      () => signing.sendSigningCompletedCopy("slug"),
      "/send_submission_email",
      "POST",
      { submitter_slug: "slug" },
    ],
    ["start form", () => start.getStartForm("slug"), "/start-form/slug", "GET"],
    [
      "start signing",
      () => start.submitStartForm("slug", { email: "signer@example.test" }),
      "/start-form/slug",
      "POST",
      { email: "signer@example.test" },
    ],
    [
      "email code send",
      () =>
        start.sendStartFormEmailVerification("slug", {
          email: "signer@example.test",
        }),
      "/start-form/slug/email-verification/send",
      "POST",
      { email: "signer@example.test" },
    ],
    [
      "email code verify",
      () => start.verifyStartFormEmail("slug", { one_time_code: "123456" }),
      "/start-form/slug/email-verification/check",
      "POST",
      { one_time_code: "123456" },
    ],
  ];
it.each(cases)(
  "%s sends the expected public signing request",
  async (_name, send, path, method, body) => {
    await send();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api" + path);
    expect(init.method ?? "GET").toBe(method);
    expect(init.headers.has("Authorization")).toBe(false);
    if (body !== undefined) expect(JSON.parse(init.body)).toEqual(body);
  },
);
it("uploads signer attachments as multipart with field type", async () => {
  await signing.uploadSigningAttachment(
    "slug",
    new File(["signature"], "signature.png"),
    "signature",
  );
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/signing/slug/attachments");
  expect(init.body.get("type")).toBe("signature");
  expect(init.body.get("file").name).toBe("signature.png");
});
