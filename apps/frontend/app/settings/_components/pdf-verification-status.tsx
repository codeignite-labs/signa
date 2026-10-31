import { CheckCircle2Icon, CircleXIcon, TriangleAlertIcon } from "lucide-react";
import type { VerifyPdfResponse } from "@/lib/api/tools";

type Signature = VerifyPdfResponse["signatures"][number];
type VerificationState = "verified" | "invalid" | "inconclusive";

function signatureState(signature: Signature): VerificationState {
  const checks = [
    signature.byte_range_valid,
    signature.cms_message_digest_valid,
    signature.cms_signature_valid,
  ];
  if (checks.some((value) => value === false)) return "invalid";
  return checks.every((value) => value === true) ? "verified" : "inconclusive";
}

const signatureLabels: Record<VerificationState, string> = {
  verified: "Signature valid",
  invalid: "Signature verification failed",
  inconclusive: "Signature verification inconclusive",
};
const chainLabels: Record<Signature["certificate_chain_status"], string> = {
  trusted: "Signed with trusted certificate",
  external: "Signed with external certificate",
  expired: "Certificate expired",
  invalid: "Certificate chain invalid",
  missing: "Certificate chain unavailable",
};

// Integrity, certificate trust and the document checksum are independent checks.
// A known completed-document checksum is not evidence of a trusted signing CA.
export function SignatureVerificationStatus({
  signature,
}: {
  signature: Signature;
}) {
  const state = signatureState(signature);
  const chain = signature.certificate_chain_status;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <StatusLine state={state} label={signatureLabels[state]} />
      <StatusLine
        state={
          chain === "trusted"
            ? "verified"
            : chain === "missing" || chain === "external"
              ? "inconclusive"
              : "invalid"
        }
        label={chainLabels[chain] ?? "Certificate chain unavailable"}
      />
    </div>
  );
}

function StatusLine({
  state,
  label,
}: {
  state: VerificationState;
  label: string;
}) {
  const Icon =
    state === "verified"
      ? CheckCircle2Icon
      : state === "invalid"
        ? CircleXIcon
        : TriangleAlertIcon;
  const color =
    state === "verified"
      ? "text-emerald-500"
      : state === "invalid"
        ? "text-rose-500"
        : "text-amber-600";
  return (
    <div className="flex items-center gap-2 text-xl font-bold leading-tight">
      <Icon aria-hidden="true" className={`size-5 ${color}`} />
      <span>{label}</span>
    </div>
  );
}
