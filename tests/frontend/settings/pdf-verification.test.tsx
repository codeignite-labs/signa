import {
  signature,
  verification,
  renderSigningSettings,
  verificationInput,
  verify,
} from "./e-signature-fixture";
import { expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";

import {
  verifyPdfFile,
  type VerifyPdfResponse,
} from "../../../apps/frontend/lib/api/tools";

it("verifies a signed document and displays its certificate, digest, timestamp and reason metadata", async () => {
  await verify(verification);
  expect(screen.getByText("Signed with Organization")).toBeTruthy();
  expect(screen.getByText("Certificate chain: CN=Organization")).toBeTruthy();
  expect(screen.getByText("Signed byte range verified")).toBeTruthy();
  expect(screen.getByText("Trusted signature timestamp verified")).toBeTruthy();
  expect(screen.getByText("ETSI.CAdES.detached signature")).toBeTruthy();
  expect(screen.getByText("Approval")).toBeTruthy();
});
it("reports a document without PDF signatures", async () => {
  await verify({ ...verification, signatures: [] });
  expect(screen.getByText("There are no signatures...")).toBeTruthy();
});
it("renders untrusted external signatures with missing metadata and failed timestamps", async () => {
  await verify({
    ...verification,
    checksum_status: "not_found",
    cryptographic_verification: false,
    signatures: [
      {
        ...signature,
        signer_name: null,
        signing_time: null,
        signing_reason: null,
        pades_compliant_sub_filter: false,
        signature_type: null,
        signature_timestamp_valid: false,
        byte_range_valid: false,
        certificate_chain_status: "external",
      },
    ],
  });
  expect(screen.getByText("Signed with Unknown signer")).toBeTruthy();
  expect(screen.getByText("Signed with external certificate")).toBeTruthy();
  expect(
    screen.getByText("Certificate chain: External PDF signature"),
  ).toBeTruthy();
  expect(
    screen.getByText("Signature timestamp validation failed"),
  ).toBeTruthy();
  expect(screen.getByText("Signed byte range unavailable")).toBeTruthy();
});
it.each<[VerifyPdfResponse["signatures"][number], string]>([
  [
    {
      ...signature,
      certificate_chain: [
        {
          ...signature.certificate_chain[0],
          subject: "O=Example, CN=Trusted TSA",
        },
      ],
    },
    "Timestamped by Trusted TSA",
  ],
  [
    {
      ...signature,
      certificate_chain: [
        { ...signature.certificate_chain[0], subject: "Organization TSA" },
      ],
    },
    "Timestamped by Organization TSA",
  ],
  [
    { ...signature, certificate_chain: [], signer_name: "Fallback TSA" },
    "Timestamped by Fallback TSA",
  ],
  [
    { ...signature, certificate_chain: [], signer_name: null },
    "Timestamped by timestamp authority",
  ],
])(
  "renders document timestamp authority from available certificate metadata",
  async (timestamp, label) => {
    await verify({
      ...verification,
      signatures: [
        {
          ...timestamp,
          timestamp_signature: true,
          signature_timestamp_valid: null,
          signing_time: "invalid",
        },
      ],
    });
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("Document timestamp")).toBeTruthy();
    expect(screen.getByText("RFC3161 timestamp")).toBeTruthy();
    expect(screen.getByText("No verified signature timestamp")).toBeTruthy();
  },
);
it("uses checksum validation and verified-signature fallback chain labels", async () => {
  await verify({ ...verification, cryptographic_verification: false });
  expect(
    screen.getByText("Certificate chain: Signa completed document checksum"),
  ).toBeTruthy();
  vi.mocked(verifyPdfFile).mockResolvedValue({
    ...verification,
    signatures: [{ ...signature, certificate_chain: [] }],
  });
  fireEvent.change(verificationInput(), {
    target: { files: [new File(["pdf"], "empty-chain.pdf")] },
  });
  await screen.findByText("Certificate chain: Verified document signature");
});
it("reports PDF verification failure and allows selecting another document", async () => {
  vi.mocked(verifyPdfFile).mockRejectedValue(new Error("Invalid PDF"));
  await renderSigningSettings();
  fireEvent.change(verificationInput(), {
    target: { files: [new File(["broken"], "broken.pdf")] },
  });
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("PDF verification failed", {
      description: "Invalid PDF",
    }),
  );
  expect(screen.queryByText("Analyzing...")).toBeNull();
  fireEvent.change(verificationInput(), { target: { files: [] } });
  expect(verifyPdfFile).toHaveBeenCalledTimes(1);
  const click = vi
    .spyOn(verificationInput(), "click")
    .mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: /Verify Signed PDF/ }));
  expect(click).toHaveBeenCalledTimes(1);
});
it("does not label a cryptographically invalid signature as valid", async () => {
  await verify({
    ...verification,
    checksum_status: "not_found",
    cryptographic_verification: false,
    signatures: [
      {
        ...signature,
        cms_signature_valid: false,
        cms_message_digest_valid: false,
        byte_range_valid: false,
        certificate_chain_status: "invalid",
      },
    ],
  });
  expect(screen.queryByText("Signature valid")).toBeNull();
});
it("keeps incomplete signature verification inconclusive even when the file checksum is known", async () => {
  await verify({
    ...verification,
    signatures: [
      {
        ...signature,
        cms_signature_valid: null,
        cms_message_digest_valid: null,
        certificate_chain_status: "missing",
      },
    ],
  });
  expect(screen.queryByText("Signature valid")).toBeNull();
  expect(screen.getByText("Signature verification inconclusive")).toBeTruthy();
  expect(screen.getByText("Certificate chain unavailable")).toBeTruthy();
  expect(screen.queryByText("Signed with trusted certificate")).toBeNull();
});
it("reports verification independently for multiple signatures and keeps certificate trust separate from checksums", async () => {
  await verify({
    ...verification,
    signatures: [
      signature,
      {
        ...signature,
        cms_signature_valid: false,
        certificate_chain_status: "external",
      },
    ],
  });
  expect(screen.getAllByText("Signature valid")).toHaveLength(1);
  expect(screen.getByText("Signature verification failed")).toBeTruthy();
  expect(screen.getByText("Signed with external certificate")).toBeTruthy();
});
it.each(["expired", "invalid", "missing"] as const)(
  "does not call a %s certificate chain trusted despite a known file checksum",
  async (certificate_chain_status) => {
    await verify({
      ...verification,
      signatures: [{ ...signature, certificate_chain_status }],
    });
    expect(screen.queryByText("Signed with trusted certificate")).toBeNull();
  },
);
it.each([
  ["D:20260101012345Z", "2026-01-01T01:23:45Z"],
  ["D:20260101042345+03'00'", "2026-01-01T01:23:45Z"],
  ["20260101T012345Z", "2026-01-01T01:23:45Z"],
  ["D:20260101", "2026-01-01T00:00:00Z"],
])(
  "parses PDF signature time %s into the actual signing instant",
  async (signing_time, instant) => {
    await verify({
      ...verification,
      signatures: [{ ...signature, signing_time }],
    });
    const expected = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(instant));
    expect(screen.getByText(expected)).toBeTruthy();
  },
);
it("uses the unknown certificate fallback for missing subject names", async () => {
  await verify({
    ...verification,
    signatures: [
      {
        ...signature,
        certificate_chain: [
          { ...signature.certificate_chain[0], subject: null },
        ],
      },
    ],
  });
  expect(
    screen.getByText("Certificate chain: Unknown certificate"),
  ).toBeTruthy();
});
it.each(["20269999T999999Z", "D:20269999"])(
  "keeps an invalid encoded signing date visible without manufacturing a date %s",
  async (signing_time) => {
    await verify({
      ...verification,
      signatures: [{ ...signature, signing_time }],
    });
    expect(screen.getByText(signing_time)).toBeTruthy();
  },
);
it("labels an unnamed uploaded document using a safe PDF fallback", async () => {
  await renderSigningSettings();
  fireEvent.change(verificationInput(), {
    target: { files: [new File(["pdf"], "")] },
  });
  await screen.findByText(/PDF document - 1/);
});
it("labels an unnamed unsigned upload using the same PDF filename fallback", async () => {
  vi.mocked(verifyPdfFile).mockResolvedValue({
    ...verification,
    signatures: [],
  });
  await renderSigningSettings();
  fireEvent.change(verificationInput(), {
    target: { files: [new File(["pdf"], "")] },
  });
  await screen.findByText("There are no signatures...");
  expect(screen.getByText("PDF document")).toBeTruthy();
});
