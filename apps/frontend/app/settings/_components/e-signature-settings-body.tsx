"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  BadgeCheckIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  CircleXIcon,
  FileTextIcon,
  IdCardIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadCloudIcon,
  UserRoundIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  type AccountPreferences,
  type DocumentFilenameFormat,
  type SigningCertificate,
  type SigningTrustRoot,
  deleteSigningCertificate,
  deleteSigningTrustRoot,
  getAccountPreferences,
  listSigningCertificates,
  listSigningTrustRoots,
  makeDefaultSigningCertificate,
  updateAccountPreferences,
  updateSigningTimestampServer,
  uploadSigningCertificate,
  uploadSigningTrustRoot,
} from "@/lib/api/auth";
import { verifyPdfFile, type VerifyPdfResponse } from "@/lib/api/tools";
import { isEqual } from "@/lib/object-diff";
import { SigningCertificatesSection } from "./signing-certificates-section";
import { CertificateUploadDialog } from "./certificate-upload-dialog";
import { SettingsSidebar } from "./settings-sidebar";

const filenameFormats: Array<{
  label: string;
  value: DocumentFilenameFormat;
}> = [
  { label: "Document Name.pdf", value: "{document.name}" },
  {
    label: "Document Name - signed.pdf",
    value: "{document.name} - {submission.status}",
  },
  {
    label: "Document Name - name@domain.com.pdf",
    value: "{document.name} - {submission.submitters}",
  },
  {
    label: "Document Name - name@domain.com - date.pdf",
    value:
      "{document.name} - {submission.submitters} - {submission.completed_at}",
  },
];

export function ESignatureSettingsBody() {
  return (
    <div className="flex w-full flex-wrap gap-8 md:flex-nowrap">
      <SettingsSidebar active="E-Signature" />
      <ESignaturePanel />
    </div>
  );
}

function ESignaturePanel() {
  const [preferences, setPreferences] = useState<AccountPreferences | null>(
    null,
  );
  const [certificates, setCertificates] = useState<SigningCertificate[]>([]);
  const [trustRoots, setTrustRoots] = useState<SigningTrustRoot[]>([]);
  const [timestampServerUrl, setTimestampServerUrl] = useState("");
  const [verification, setVerification] = useState<VerifyPdfResponse | null>(
    null,
  );
  const [verificationFileName, setVerificationFileName] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    Promise.all([
      getAccountPreferences(),
      listSigningCertificates(),
      listSigningTrustRoots(),
    ])
      .then(([loadedPreferences, loadedCertificates, loadedTrustRoots]) => {
        setPreferences(loadedPreferences);
        setCertificates(loadedCertificates.data);
        setTrustRoots(loadedTrustRoots.data);
        setTimestampServerUrl(loadedCertificates.timestamp_server_url ?? "");
      })
      .catch((error: unknown) =>
        toast.error("E-signature settings could not be loaded", {
          description: getErrorMessage(error),
        }),
      );
  }, []);

  async function verifyPdf(file: File) {
    setIsVerifying(true);
    setVerification(null);
    setVerificationFileName(file.name);

    try {
      const result = await verifyPdfFile(file);

      setVerification(result);
      toast.success("PDF verification completed");
    } catch (error) {
      toast.error("PDF verification failed", {
        description: getErrorMessage(error),
      });
    } finally {
      setIsVerifying(false);
    }
  }

  async function savePreference(patch: Partial<AccountPreferences>) {
    const hasChanges = Object.entries(patch).some(([key, value]) => {
      return !isEqual(value, preferences?.[key as keyof AccountPreferences]);
    });

    if (!hasChanges) {
      return;
    }

    try {
      setPreferences(await updateAccountPreferences(patch));
      toast.success("E-signature preferences saved");
    } catch (error) {
      toast.error("E-signature preferences failed to save", {
        description: getErrorMessage(error),
      });
    }
  }

  async function uploadCertificate(file: File, name: string, password: string) {
    try {
      await uploadSigningCertificate(file, name, password);
      const nextCertificates = await listSigningCertificates();

      setCertificates(nextCertificates.data);
      setTimestampServerUrl(nextCertificates.timestamp_server_url ?? "");
      toast.success("Signing certificate uploaded");
    } catch (error) {
      throw error;
    }
  }

  async function setDefaultCertificate(name: string) {
    await makeDefaultSigningCertificate(name);
    const nextCertificates = await listSigningCertificates();

    setCertificates(nextCertificates.data);
    setTimestampServerUrl(nextCertificates.timestamp_server_url ?? "");
    toast.success("Active signing identity updated");
  }

  async function removeCertificate(name: string) {
    await deleteSigningCertificate(name);
    const nextCertificates = await listSigningCertificates();

    setCertificates(nextCertificates.data);
    setTimestampServerUrl(nextCertificates.timestamp_server_url ?? "");
    toast.success("Signing certificate removed");
  }

  async function uploadTrustRoot(file: File, name: string) {
    try {
      await uploadSigningTrustRoot(file, name);
      const nextTrustRoots = await listSigningTrustRoots();

      setTrustRoots(nextTrustRoots.data);
      toast.success("Trust root uploaded");
    } catch (error) {
      throw error;
    }
  }

  async function removeTrustRoot(id: string) {
    try {
      await deleteSigningTrustRoot(id);
      const nextTrustRoots = await listSigningTrustRoots();

      setTrustRoots(nextTrustRoots.data);
      toast.success("Trust root removed");
    } catch (error) {
      toast.error("Trust root removal failed", {
        description: getErrorMessage(error),
      });
    }
  }

  async function saveTimestampServerUrl(value: string) {
    const nextValue = value.trim();
    const currentValue = timestampServerUrl.trim();

    if (nextValue === currentValue) {
      return;
    }

    try {
      const nextCertificates = await updateSigningTimestampServer(
        nextValue || null,
      );

      setCertificates(nextCertificates.data);
      setTimestampServerUrl(nextCertificates.timestamp_server_url ?? "");
      toast.success("Timestamp server saved");
    } catch (error) {
      toast.error("Timestamp server failed to save", {
        description: getErrorMessage(error),
      });
    }
  }

  return (
    <section className="w-full min-w-0 md:flex-1">
      <h1 className="text-4xl font-bold tracking-normal">PDF Signature</h1>
      <p className="mt-5">Upload signed PDF file to validate its signature:</p>
      <PdfVerificationDropzone isVerifying={isVerifying} onFile={verifyPdf} />
      <VerificationResult
        fileName={verificationFileName}
        verification={verification}
      />

      <SigningCertificatesSection
        certificates={certificates}
        onMakeDefault={setDefaultCertificate}
        onRemove={removeCertificate}
        onTimestampServerSave={saveTimestampServerUrl}
        onUpload={uploadCertificate}
        timestampServerUrl={timestampServerUrl}
      />
      <TrustRootsSection
        onRemove={removeTrustRoot}
        onUpload={uploadTrustRoot}
        trustRoots={trustRoots}
      />

      {preferences ? (
        <ESignaturePreferences
          onSave={savePreference}
          preferences={preferences}
        />
      ) : null}
    </section>
  );
}

function TrustRootsSection({
  onRemove,
  onUpload,
  trustRoots,
}: {
  onRemove: (id: string) => Promise<void>;
  onUpload: (file: File, name: string) => Promise<void>;
  trustRoots: SigningTrustRoot[];
}) {
  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-normal">
            Trusted Certificate Authorities
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Approve public CA certificates for signing identities and PDF verification in this workspace. Uploading a private CA does not make it publicly trusted.
          </p>
        </div>
        <CertificateUploadDialog kind="trust" onUpload={onUpload} />
      </div>
      <TrustRootTable onRemove={onRemove} trustRoots={trustRoots} />
    </div>
  );
}

function TrustRootTable({
  onRemove,
  trustRoots,
}: {
  onRemove: (id: string) => Promise<void>;
  trustRoots: SigningTrustRoot[];
}) {
  if (!trustRoots.length) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
        No external trust roots have been uploaded.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-t-2xl">
      <table className="w-full text-left">
        <thead className="bg-[var(--auth-muted)] text-xs uppercase">
          <tr>
            <th className="px-5 py-4">Name</th>
            <th className="px-5 py-4">Subject</th>
            <th className="px-5 py-4">Valid to</th>
            <th className="px-5 py-4 text-right" />
          </tr>
        </thead>
        <tbody>
          {trustRoots.map((root) => (
            <tr className="border-b" key={root.id}>
              <td className="px-5 py-4 font-semibold">{root.name}</td>
              <td className="max-w-80 px-5 py-4">
                <p className="truncate">{root.subject}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {root.fingerprint_sha256}
                </p>
              </td>
              <td className="px-5 py-4">{formatDate(root.valid_to)}</td>
              <td className="px-5 py-4 text-right">
                <button
                  className="inline-flex items-center gap-1 text-xs font-bold text-destructive underline underline-offset-4"
                  onClick={() => void onRemove(root.id)}
                  type="button"
                >
                  <Trash2Icon className="size-3.5" />
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ESignaturePreferences({
  onSave,
  preferences,
}: {
  onSave: (patch: Partial<AccountPreferences>) => Promise<void>;
  preferences: AccountPreferences;
}) {
  return (
    <div className="mt-9 max-w-xl space-y-6">
      <h2 className="text-3xl font-bold tracking-normal">Preferences</h2>
      <PreferenceSwitch
        checked={preferences.esigning_preference === "multiple"}
        label="Apply multiple PDF digital signatures in the document per each signer"
        onCheckedChange={(checked) =>
          void onSave({
            esigning_preference: checked ? "multiple" : "single",
          })
        }
      />
      <PreferenceSwitch
        checked={preferences.flatten_result_pdf}
        label="Remove PDF form fillable fields from the signed PDF (flatten form)"
        onCheckedChange={(flatten_result_pdf) =>
          void onSave({ flatten_result_pdf })
        }
      />
      <div className="rounded-2xl border border-border bg-card p-4">
        <PreferenceSwitch
          checked={preferences.auto_sign_owner_enabled}
          label="Auto-sign the account owner role when creating submissions"
          onCheckedChange={(auto_sign_owner_enabled) =>
            void onSave({ auto_sign_owner_enabled })
          }
        />
        <p className="mt-2 text-sm text-muted-foreground">
          Use the owner saved signature for the configured role before sending
          the request to other recipients.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="owner-role-name">Owner role name</Label>
            <Input
              autoComplete="off"
              className="h-12 rounded-full"
              disabled={!preferences.auto_sign_owner_enabled}
              id="owner-role-name"
              name="ownerRoleName"
              onBlur={(event) => {
                const role = event.currentTarget.value.trim() || "First Party";

                if (role !== preferences.auto_sign_owner_role) {
                  void onSave({ auto_sign_owner_role: role });
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              placeholder="First Party"
              defaultValue={preferences.auto_sign_owner_role || "First Party"}
            />
          </div>
          <div className="flex items-end pb-2">
            <PreferenceSwitch
              checked={preferences.auto_sign_owner_send_email}
              label="Email owner"
              onCheckedChange={(auto_sign_owner_send_email) =>
                void onSave({ auto_sign_owner_send_email })
              }
            />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="document-filename-format">
          Document download filename format
        </Label>
        <Select
          onValueChange={(document_filename_format) =>
            void onSave({
              document_filename_format:
                document_filename_format as DocumentFilenameFormat,
            })
          }
          value={preferences.document_filename_format}
        >
          <SelectTrigger
            className="h-12 rounded-full"
            id="document-filename-format"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {filenameFormats.map((format) => (
              <SelectItem key={format.value} value={format.value}>
                {format.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function PdfVerificationDropzone({
  isVerifying,
  onFile,
}: {
  isVerifying: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <button
      className="mt-3 flex h-32 w-full max-w-xl flex-col items-center justify-center rounded-md border border-dashed border-input bg-card text-center transition-colors hover:bg-muted"
      onClick={() => inputRef.current?.click()}
      type="button"
    >
      <UploadCloudIcon className="size-8" />
      <span className="mt-1 font-bold">
        {isVerifying ? "Analyzing..." : "Verify Signed PDF"}
      </span>
      <span className="text-xs">Click to upload or drag and drop files</span>
      <input
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) {
            onFile(file);
          }
        }}
        ref={inputRef}
        type="file"
      />
    </button>
  );
}

function VerificationResult({
  fileName,
  verification,
}: {
  fileName: string;
  verification: VerifyPdfResponse | null;
}) {
  if (!verification) {
    return null;
  }

  const signatures = verification.signatures;
  const signatureCount = signatures.length;
  const isTrusted = verification.checksum_status === "verified";

  if (signatureCount === 0) {
    return (
      <div className="mt-5 w-full max-w-xl rounded-md border bg-card px-4 py-3">
        <p className="text-sm">{fileName || "PDF document"}</p>
        <p className="mt-2 text-xl font-bold">There are no signatures...</p>
      </div>
    );
  }

  return (
    <div className="mt-5 w-full max-w-xl rounded-md border bg-card px-4 py-3">
      <div className="flex items-center gap-2 border-b border-dashed pb-3 text-sm">
        <FileTextIcon className="size-4" />
        <span>
          {fileName || "PDF document"} - {signatureCount}{" "}
          {signatureCount === 1 ? "Signature" : "Signatures"}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <VerificationStatusLine icon="success" label="Signature valid" />
        <VerificationStatusLine
          icon={isTrusted ? "success" : "error"}
          label={
            isTrusted
              ? "Signed with trusted certificate"
              : "Signed with external certificate"
          }
        />
        <p className="text-xl font-bold leading-snug">
          Certificate chain: {getCertificateChainLabel(verification)}
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-1.5 text-sm">
        {signatures.map((signature, index) => (
          <SignatureMetadata
            key={`${signature.signature_type ?? "signature"}-${index}`}
            signature={signature}
          />
        ))}
      </div>
    </div>
  );
}

function VerificationStatusLine({
  icon,
  label,
}: {
  icon: "error" | "success";
  label: string;
}) {
  const Icon = icon === "success" ? CheckCircle2Icon : CircleXIcon;

  return (
    <div className="flex items-center gap-2 text-xl font-bold leading-tight">
      <Icon
        className={
          icon === "success"
            ? "size-5 text-emerald-500"
            : "size-5 text-rose-500"
        }
      />
      <span>{label}</span>
    </div>
  );
}

function SignatureMetadata({
  signature,
}: {
  signature: VerifyPdfResponse["signatures"][number];
}) {
  const isTimestampSignature = signature.timestamp_signature;
  const signerLabel = isTimestampSignature
    ? `Timestamped by ${getTimestampAuthorityLabel(signature)}`
    : `Signed with ${signature.signer_name ?? "Unknown signer"}`;

  return (
    <>
      <MetadataLine icon={UserRoundIcon} label={signerLabel} />
      <MetadataLine
        icon={CalendarDaysIcon}
        label={formatSigningTime(signature.signing_time)}
      />
      <MetadataLine
        icon={IdCardIcon}
        label={
          isTimestampSignature
            ? "Document timestamp"
            : (signature.signing_reason ?? "Signed document")
        }
      />
      <MetadataLine
        icon={ShieldCheckIcon}
        label={
          isTimestampSignature
            ? "RFC3161 timestamp"
            : signature.pades_compliant_sub_filter
              ? "ETSI.CAdES.detached signature"
              : (signature.signature_type ?? "PDF signature")
        }
      />
      <MetadataLine
        icon={CalendarDaysIcon}
        label={
          signature.signature_timestamp_valid === true
            ? "Trusted signature timestamp verified"
            : signature.signature_timestamp_valid === false
              ? "Signature timestamp validation failed"
              : "No verified signature timestamp"
        }
      />
      <MetadataLine
        icon={BadgeCheckIcon}
        label={
          signature.byte_range_valid
            ? "Signed byte range verified"
            : "Signed byte range unavailable"
        }
      />
    </>
  );
}

function getTimestampAuthorityLabel(
  signature: VerifyPdfResponse["signatures"][number],
): string {
  return (
    getCertificateSubjectCommonName(
      signature.certificate_chain.at(0)?.subject,
    ) ??
    signature.signer_name ??
    "timestamp authority"
  );
}

function getCertificateSubjectCommonName(subject: string | null | undefined) {
  if (!subject) {
    return null;
  }

  const commonName = /(?:^|,\s*)CN=([^,]+)/.exec(subject)?.[1]?.trim();

  return commonName || subject;
}

function MetadataLine({
  icon: Icon,
  label,
}: {
  icon: typeof BadgeCheckIcon;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4" />
      <span>{label}</span>
    </div>
  );
}

function getCertificateChainLabel(verification: VerifyPdfResponse): string {
  if (verification.cryptographic_verification) {
    return (
      verification.signatures
        .find((signature) => signature.cms_signature_valid)
        ?.certificate_chain.map(
          (certificate) => certificate.subject ?? "Unknown certificate",
        )
        .join(" → ") || "Verified document signature"
    );
  }

  return verification.checksum_status === "verified"
    ? "Signa completed document checksum"
    : "External PDF signature";
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString();
}

function formatSigningTime(value: string | null): string {
  if (!value) {
    return "Signing time unavailable";
  }

  const date = parsePdfSigningDate(value) ?? new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function parsePdfSigningDate(value: string): Date | null {
  const normalized = value.startsWith("D:") ? value.slice(2) : value;
  const generalizedTimeMatch =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(normalized);

  if (generalizedTimeMatch) {
    const [, year, month, day, hour, minute, second] = generalizedTimeMatch;
    const parsedGeneralizedTime = new Date(
      `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
    );

    return Number.isNaN(parsedGeneralizedTime.getTime())
      ? null
      : parsedGeneralizedTime;
  }

  const match =
    /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?$/.exec(
      normalized,
    );

  if (!match) {
    return null;
  }

  const [
    ,
    year,
    month,
    day,
    hour = "00",
    minute = "00",
    second = "00",
    timezone = "",
  ] = match;
  const parsedDate = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}${formatPdfTimezone(
      timezone,
    )}`,
  );

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function formatPdfTimezone(timezone: string): string {
  if (!timezone || timezone === "Z") {
    return "Z";
  }

  const normalized = timezone.replaceAll("'", "");

  return `${normalized.slice(0, 3)}:${normalized.slice(3, 5)}`;
}

function PreferenceSwitch({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-5 py-2.5">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}
