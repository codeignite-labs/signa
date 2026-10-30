import "./form-upload-fixture";
import "./browser-settings-fixture";
import { beforeEach, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { ESignatureSettingsBody } from "../../../apps/frontend/app/settings/_components/e-signature-settings-body";
import * as auth from "../../../apps/frontend/lib/api/auth";
import {
  verifyPdfFile,
  type VerifyPdfResponse,
} from "../../../apps/frontend/lib/api/tools";
import { preferences } from "./preferences-fixture";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "../../../apps/frontend/app/settings/_components/settings-sidebar",
  () => ({ SettingsSidebar: () => null }),
);
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  getAccountPreferences: vi.fn(),
  listSigningCertificates: vi.fn(),
  listSigningTrustRoots: vi.fn(),
  updateAccountPreferences: vi.fn(),
  uploadSigningCertificate: vi.fn(),
  makeDefaultSigningCertificate: vi.fn(),
  deleteSigningCertificate: vi.fn(),
  updateSigningTimestampServer: vi.fn(),
  uploadSigningTrustRoot: vi.fn(),
  deleteSigningTrustRoot: vi.fn(),
}));
vi.mock("../../../apps/frontend/lib/api/tools", () => ({
  verifyPdfFile: vi.fn(),
}));
export const certificate: auth.SigningCertificate = {
  name: "Organization Signing",
  is_active: false,
  status: "active",
  subject: "CN=Organization",
  issuer: "CN=Example CA",
  fingerprint_sha256: "fingerprint",
  serial_number: "serial",
  valid_from: "2026-01-01",
  valid_to: "2126-01-01",
};
export const trustRoot: auth.SigningTrustRoot = {
  id: "root-1",
  name: "Example CA",
  subject: "CN=Root CA",
  issuer: "CN=Root CA",
  enabled: true,
  fingerprint_sha256: "root-fingerprint",
  serial_number: "root-serial",
  valid_from: "2026-01-01",
  valid_to: "2126-01-01",
  created_at: "2026-01-01",
};
export const signature: VerifyPdfResponse["signatures"][number] = {
  byte_range_sha256: "sha",
  byte_range_valid: true,
  pades_compliant_sub_filter: true,
  timestamp_signature: false,
  signature_timestamp_valid: true,
  verification_result: [],
  certificate_chain_status: "trusted",
  certificate_policy_errors: [],
  certificate_chain: [
    {
      issuer: "CN=Root",
      serial_number: "serial",
      subject: "CN=Organization",
      valid_from: "2026-01-01",
      valid_to: "2126-01-01",
    },
  ],
  cms_message_digest_valid: true,
  cms_signature_valid: true,
  ltv_status: "valid",
  revocation_status: "good",
  signer_name: "Organization",
  signing_reason: "Approval",
  signing_time: "2026-01-01T00:00:00Z",
  signature_type: "ETSI.CAdES.detached",
  trust_anchor: "Root",
  trust_anchor_fingerprint: "fingerprint",
};
export const verification: VerifyPdfResponse = {
  checksum_status: "verified",
  cryptographic_verification: true,
  sha256: "sha256",
  signatures: [signature],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.getAccountPreferences).mockResolvedValue(preferences);
  vi.mocked(auth.listSigningCertificates).mockResolvedValue({
    data: [certificate],
    timestamp_server_url: "https://tsa.example.test",
  });
  vi.mocked(auth.listSigningTrustRoots).mockResolvedValue({
    data: [trustRoot],
  });
  vi.mocked(auth.updateAccountPreferences).mockImplementation(
    async (patch) => ({ ...preferences, ...patch }),
  );
  vi.mocked(auth.updateSigningTimestampServer).mockImplementation(
    async (url) => ({ data: [certificate], timestamp_server_url: url }),
  );
  vi.mocked(verifyPdfFile).mockResolvedValue(verification);
});
export async function renderSigningSettings() {
  render(<ESignatureSettingsBody />);
  await screen.findByText(certificate.name);
}
export function verificationInput() {
  return document.querySelector<HTMLInputElement>(
    'input[accept=".pdf,application/pdf"]',
  )!;
}
export async function verify(result: VerifyPdfResponse) {
  vi.mocked(verifyPdfFile).mockResolvedValue(result);
  await renderSigningSettings();
  fireEvent.change(verificationInput(), {
    target: {
      files: [new File(["pdf"], "signed.pdf", { type: "application/pdf" })],
    },
  });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("PDF verification completed"),
  );
}
