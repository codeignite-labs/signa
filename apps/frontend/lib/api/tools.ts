import { authenticatedApiFetch } from "./auth";

export type VerifyPdfResponse = {
  checksum_status: "verified" | "not_found";
  cryptographic_verification: boolean;
  sha256: string;
  signatures: Array<{
    byte_range_sha256: string | null;
    byte_range_valid: boolean;
    pades_compliant_sub_filter: boolean;
    timestamp_signature: boolean;
    signature_timestamp_valid: boolean | null;
    verification_result: string[];
    certificate_chain_status:
      | "expired"
      | "external"
      | "invalid"
      | "missing"
      | "trusted";
    certificate_policy_errors: string[];
    certificate_chain: Array<{
      issuer: string | null;
      serial_number: string | null;
      subject: string | null;
      valid_from: string | null;
      valid_to: string | null;
    }>;
    cms_message_digest_valid: boolean | null;
    cms_signature_valid: boolean | null;
    ltv_status: "invalid" | "missing" | "valid";
    revocation_status:
      | "good"
      | "missing"
      | "revoked"
      | "unavailable"
      | "unknown";
    signer_name: string | null;
    signing_reason: string | null;
    signing_time: string | null;
    signature_type: string | null;
    trust_anchor: string | null;
    trust_anchor_fingerprint: string | null;
  }>;
};

export async function verifyPdfFile(file: File): Promise<VerifyPdfResponse> {
  const formData = new FormData();
  formData.set("file", file, file.name);

  return authenticatedApiFetch<VerifyPdfResponse>("/tools/verify", {
    body: formData,
    method: "POST",
  });
}
