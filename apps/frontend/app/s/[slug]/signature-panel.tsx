"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SignatureCanvas } from "@/components/signing/signature-canvas";
import {
  AsYouType,
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import examples from "libphonenumber-js/mobile/examples";
import {
  CheckIcon,
  CalendarCheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  Maximize2Icon,
  ImageUpIcon,
  Minimize2Icon,
  PaperclipIcon,
  PenLineIcon,
  QrCodeIcon,
  RotateCcwIcon,
  SearchIcon,
  TypeIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type SignatureCanvasType from "react-signature-canvas";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  getSigningFieldValue,
  sendSigningPhoneVerification,
  type SigningAttachment,
  type SigningField,
  type SigningForm,
  validateSigningPhoneNumber,
  verifySigningPhoneCode,
} from "@/lib/api/signing";
import phoneData from "@/lib/phone-data";
import { cn } from "@/lib/utils";

type SignatureMode = "draw" | "phone" | "type" | "upload";
type PhoneAcceptance = {
  acceptedValue?: string;
  verifiedValue?: string;
  onAccept: (phone: string) => void;
  onVerify: (phone: string) => void;
};

type SavedSignatureAsset = {
  uuid: string;
  filename: string;
  content_type: string | null;
  url: string;
};

export function SignaturePanel({
  activeField,
  fields,
  form,
  onFormChange,
  onComplete,
  onSaveField,
  onSelectField,
  onUploadAttachment,
  savedAssets,
}: {
  activeField?: SigningField | null;
  fields: SigningField[];
  form: SigningForm;
  onFormChange: (form: SigningForm) => void;
  onComplete: (
    field: SigningField,
    value: unknown,
    extraValues?: Record<string, unknown>,
  ) => Promise<void>;
  onSaveField: (
    field: SigningField,
    value: unknown,
    extraValues?: Record<string, unknown>,
  ) => Promise<void>;
  onSelectField: (field: SigningField) => void;
  onUploadAttachment: (file: File, type: string) => Promise<string>;
  savedAssets?: {
    initials: SavedSignatureAsset | null;
    signature: SavedSignatureAsset | null;
  };
}) {
  const [mode, setMode] = useState<SignatureMode>("draw");
  const [acceptedPhoneValues, setAcceptedPhoneValues] = useState(() =>
    getSavedPhoneValues(fields, form),
  );
  const [verifiedPhoneValues, setVerifiedPhoneValues] = useState<
    Record<string, string>
  >({});
  const [typedSignature, setTypedSignature] = useState(
    form.submitter.name ?? "",
  );
  const [signingReason, setSigningReason] = useState("");
  const [fieldValue, setFieldValue] = useState("");
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [attachmentValueUuids, setAttachmentValueUuids] = useState<string[]>(
    [],
  );
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [signatureDrawDataUrl, setSignatureDrawDataUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isSavedAssetDismissed, setIsSavedAssetDismissed] = useState(false);
  const [invalidFieldKey, setInvalidFieldKey] = useState<string | null>(null);
  const [remoteSignatureAttachment, setRemoteSignatureAttachment] =
    useState<SigningAttachment | null>(null);
  const signaturePadRef = useRef<SignatureCanvasType | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signaturePreviewUrlRef = useRef<string | null>(null);
  const lastActiveFieldKeyRef = useRef("");

  const activeFieldKey = activeField ? getFieldKey(activeField) : "";
  const isSignatureField =
    activeField?.type === "signature" || activeField?.type === "initials";
  const canTypeSignature = form.configs.with_typed_signature;
  const savedSignatureAsset =
    activeField?.type === "initials"
      ? savedAssets?.initials
      : savedAssets?.signature;
  const shouldUseSavedSignature =
    isSignatureField &&
    mode === "draw" &&
    !!savedSignatureAsset &&
    !isSavedAssetDismissed &&
    !remoteSignatureAttachment;
  const attachmentsIndex = useMemo(
    () =>
      Object.fromEntries(
        form.attachments.map((attachment) => [attachment.uuid, attachment]),
      ),
    [form.attachments],
  );
  const editableFields = useMemo(
    () => fields.filter((field) => !field.readonly),
    [fields],
  );
  const previewFieldValue = useCallback(
    (value: unknown, previewAttachment?: SigningAttachment) => {
      if (!activeField) {
        return;
      }

      const attachments = previewAttachment
        ? [
            ...form.attachments.filter(
              (attachment) => attachment.uuid !== previewAttachment.uuid,
            ),
            previewAttachment,
          ]
        : form.attachments;

      onFormChange({
        ...form,
        attachments,
        values: {
          ...form.values,
          [activeFieldKey]: value,
        },
      });
    },
    [activeField, activeFieldKey, form, onFormChange],
  );

  useEffect(() => {
    if (!activeField) {
      return;
    }

    const value = form.values[activeFieldKey] ?? activeField.default_value;
    const isNewActiveField = lastActiveFieldKeyRef.current !== activeFieldKey;

    lastActiveFieldKeyRef.current = activeFieldKey;

    queueMicrotask(() => {
      setFieldValue(getStringFieldValue(value));
      setSelectedOptions(getStringArrayFieldValue(value));
      setAttachmentValueUuids(getStringArrayFieldValue(value));
      setSigningReason(getSigningReasonValue(form, activeField));
      if (isNewActiveField) {
        setInvalidFieldKey(null);
        clearSignaturePreviewUrl(signaturePreviewUrlRef);
        setUploadedFiles([]);
        setSignatureDrawDataUrl("");
        setRemoteSignatureAttachment(null);
        setIsSavedAssetDismissed(false);
        setIsMinimized(false);
        if (shouldUseSavedSignature && savedSignatureAsset) {
          previewFieldValue(
            savedSignatureAsset.uuid,
            createLocalSigningAttachment(
              savedSignatureAsset.uuid,
              savedSignatureAsset.filename,
              savedSignatureAsset.content_type,
              savedSignatureAsset.url,
            ),
          );
        }
      }
    });
  }, [
    activeField,
    activeFieldKey,
    form,
    previewFieldValue,
    savedSignatureAsset,
    shouldUseSavedSignature,
  ]);

  useEffect(() => {
    if (!activeField || mode !== "phone" || !isSignatureField) {
      return;
    }

    const fieldUuid = activeField.uuid;

    if (!fieldUuid) {
      return;
    }

    const after = new Date().toISOString();
    const mobileUrl = getMobileSignatureUrl(form.submitter.slug, fieldUuid);

    void renderQrCode(qrCanvasRef.current, mobileUrl);

    const interval = window.setInterval(() => {
      getSigningFieldValue(form.submitter.slug, fieldUuid, after)
        .then((response) => {
          if (response.attachment?.uuid) {
            setRemoteSignatureAttachment(response.attachment);
            previewFieldValue(response.attachment.uuid, response.attachment);
            setMode("draw");
            window.clearInterval(interval);
          }
        })
        .catch((pollError: unknown) => {
          if (process.env.NODE_ENV === "development") {
            console.error(pollError);
          }
        });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [
    activeField,
    form.submitter.slug,
    isSignatureField,
    mode,
    previewFieldValue,
  ]);

  useEffect(() => () => clearSignaturePreviewUrl(signaturePreviewUrlRef), []);

  if (!activeField) {
    return null;
  }

  const selectedField = activeField;
  const activeStepIndex = getSigningStepIndex(editableFields, selectedField);
  const title =
    selectedField.name ||
    selectedField.title ||
    getDefaultFieldTitle(selectedField);
  const isLastEditableField = !getNextEditableField(
    editableFields,
    selectedField,
  );
  const isReadyToComplete =
    isLastEditableField &&
    hasRequiredFieldValue(form, selectedField) &&
    getIncompleteFieldsExceptCurrent(fields, form, selectedField).length === 0;
  const isInvalid = invalidFieldKey === getFieldKey(selectedField);

  function guardCurrentFieldNavigation() {
    const draftValue = getDraftFieldValue(selectedField);

    if (
      isRequiredField(selectedField) &&
      !hasDraftValue(selectedField, draftValue)
    ) {
      setInvalidFieldKey(getFieldKey(selectedField));
      toast.error("Complete the required field", {
        description: `${title} is required before you can continue.`,
      });
      return false;
    }

    return true;
  }

  function selectFieldAfterValidation(field: SigningField) {
    if (getFieldKey(field) === getFieldKey(selectedField)) {
      return;
    }

    if (guardCurrentFieldNavigation()) {
      onSelectField(field);
    }
  }

  function previewSignatureAttachment(attachment: SigningAttachment | null) {
    if (!attachment) {
      previewFieldValue("");
      return;
    }

    previewFieldValue(attachment.uuid, attachment);
  }

  function previewSignatureDrawing() {
    const pad = signaturePadRef.current;

    if (!pad || pad.isEmpty()) {
      setSignatureDrawDataUrl("");
      previewSignatureAttachment(null);
      return;
    }

    const dataUrl = pad.getTrimmedCanvas().toDataURL("image/png");

    setSignatureDrawDataUrl(dataUrl);
    previewSignatureAttachment(
      createLocalSigningAttachment(
        "signing-signature-preview",
        "signature.png",
        "image/png",
        dataUrl,
      ),
    );
  }

  function previewSignatureFile(file: File | null) {
    clearSignaturePreviewUrl(signaturePreviewUrlRef);

    if (!file) {
      previewSignatureAttachment(null);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    signaturePreviewUrlRef.current = previewUrl;

    previewSignatureAttachment(
      createLocalSigningAttachment(
        "signing-upload-preview",
        file.name,
        file.type || "image/png",
        previewUrl,
      ),
    );
  }

  async function previewTypedSignature(value: string) {
    const signature = value.trim();

    if (!signature) {
      previewSignatureAttachment(null);
      return;
    }

    const file = await typedSignatureToFile(signature);
    const previewUrl = URL.createObjectURL(file);

    clearSignaturePreviewUrl(signaturePreviewUrlRef);
    signaturePreviewUrlRef.current = previewUrl;
    previewSignatureAttachment(
      createLocalSigningAttachment(
        "signing-typed-preview",
        file.name,
        file.type || "image/png",
        previewUrl,
      ),
    );
  }

  if (isMinimized) {
    const minimizedLabel =
      selectedField.type === "signature" || selectedField.type === "initials"
        ? "SIGN NOW"
        : "CONTINUE";

    return (
      <div className="fixed inset-x-0 bottom-3 z-30 flex justify-center px-[2%] sm:bottom-4 sm:px-4">
        <Button
          className="relative h-12 w-full rounded-full bg-[var(--auth-primary)] text-sm font-bold text-[var(--auth-primary-foreground)] shadow-2xl hover:bg-[var(--auth-primary-hover)] sm:max-w-3xl"
          onClick={() => setIsMinimized(false)}
          type="button"
        >
          {selectedField.type === "signature" ||
          selectedField.type === "initials" ? (
            <PenLineIcon data-icon="inline-start" />
          ) : null}
          {minimizedLabel}
          <Maximize2Icon className="absolute right-5" data-icon="inline-end" />
        </Button>
      </div>
    );
  }

  async function saveActiveField() {
    if (!guardCurrentFieldNavigation()) {
      return;
    }

    const draftValue = getDraftFieldValue(selectedField);
    setIsSaving(true);

    try {
      const extraValues = collectExtraFieldValues(selectedField);
      const value =
        !isRequiredField(selectedField) &&
        !hasDraftValue(selectedField, draftValue)
          ? draftValue
          : await collectActiveFieldValue(selectedField);
      const nextValues = {
        ...form.values,
        ...extraValues,
        [getFieldKey(selectedField)]: value,
      };
      const shouldCompleteAfterSave =
        !getNextEditableField(editableFields, selectedField) &&
        getIncompleteFieldsExceptCurrent(
          fields,
          { ...form, values: nextValues },
          selectedField,
        ).length === 0;

      if (shouldCompleteAfterSave) {
        await onComplete(selectedField, value, extraValues);
      } else {
        await onSaveField(selectedField, value, extraValues);
        toast.success("Field saved");
      }
    } catch (saveError) {
      const message =
        saveError instanceof Error
          ? saveError.message
          : "Field could not be saved.";

      setInvalidFieldKey(getFieldKey(selectedField));
      toast.error("Signing failed", { description: message });
    } finally {
      setIsSaving(false);
    }
  }

  function getDraftFieldValue(field: SigningField): unknown {
    if (field.type === "multiple") {
      return selectedOptions;
    }

    if (field.type === "file") {
      return [
        ...attachmentValueUuids,
        ...uploadedFiles.map((file) => file.name),
      ];
    }

    if (field.type === "image" || field.type === "stamp") {
      return fieldValue || uploadedFiles[0]?.name || "";
    }

    if (field.type === "signature" || field.type === "initials") {
      if (remoteSignatureAttachment?.uuid) {
        return remoteSignatureAttachment.uuid;
      }

      if (shouldUseSavedSignature && savedSignatureAsset) {
        return savedSignatureAsset.uuid;
      }

      if (mode === "draw") {
        return signatureDrawDataUrl || signaturePadRef.current?.toData().length
          ? "drawn-signature"
          : "";
      }

      if (mode === "upload") {
        return uploadedFiles[0]?.name ?? "";
      }

      if (mode === "type") {
        return typedSignature.trim();
      }

      return "";
    }

    return fieldValue;
  }

  function collectExtraFieldValues(
    field: SigningField,
  ): Record<string, unknown> {
    if (
      !form.configs.require_signing_reason ||
      (field.type !== "signature" && field.type !== "initials")
    ) {
      return {};
    }

    if (!field.uuid) {
      throw new Error("Signing reason cannot be saved without a field ID.");
    }

    const reason = signingReason.trim();

    if (!reason) {
      throw new Error("Enter a signing reason before completing.");
    }

    return { [getSigningReasonValueKey(field.uuid)]: reason };
  }

  async function collectSignatureValue(): Promise<string> {
    clearSignaturePreviewUrl(signaturePreviewUrlRef);

    if (remoteSignatureAttachment?.uuid) {
      return remoteSignatureAttachment.uuid;
    }

    const signingType =
      selectedField.type === "initials" ? "initials" : "signature";

    if (shouldUseSavedSignature && savedSignatureAsset) {
      const file = await remoteImageToFile(savedSignatureAsset);

      return onUploadAttachment(file, signingType);
    }

    if (mode === "draw") {
      const pad = signaturePadRef.current;

      if ((!pad || pad.isEmpty()) && !signatureDrawDataUrl) {
        throw new Error("Draw your signature before completing.");
      }

      const dataUrl =
        pad && !pad.isEmpty()
          ? pad.getTrimmedCanvas().toDataURL("image/png")
          : signatureDrawDataUrl;
      const file = dataUrlToFile(dataUrl, `${signingType}.png`);

      return onUploadAttachment(file, signingType);
    }

    if (mode === "upload") {
      const uploadedFile = uploadedFiles[0];

      if (!uploadedFile) {
        throw new Error("Upload a signature image before completing.");
      }

      return onUploadAttachment(uploadedFile, signingType);
    }

    if (mode === "phone") {
      throw new Error(
        "Scan the QR code and complete the signature on your phone.",
      );
    }

    if (!typedSignature.trim()) {
      throw new Error("Type your signature before completing.");
    }

    const file = await typedSignatureToFile(typedSignature.trim());

    return onUploadAttachment(file, signingType);
  }

  async function collectActiveFieldValue(
    field: SigningField,
  ): Promise<unknown> {
    if (field.type === "signature" || field.type === "initials") {
      return collectSignatureValue();
    }

    if (field.type === "image" || field.type === "stamp") {
      const uploadedFile = uploadedFiles[0];

      if (!uploadedFile) {
        if (fieldValue) {
          return fieldValue;
        }

        throw new Error("Upload an image before continuing.");
      }

      return onUploadAttachment(uploadedFile, field.type);
    }

    if (field.type === "file") {
      if (!uploadedFiles.length && !attachmentValueUuids.length) {
        throw new Error("Upload a file before continuing.");
      }

      const newAttachmentUuids = await Promise.all(
        uploadedFiles.map((file) => onUploadAttachment(file, "file")),
      );

      return [...attachmentValueUuids, ...newAttachmentUuids];
    }

    if (field.type === "multiple") {
      return selectedOptions;
    }

    if (
      field.type === "phone" &&
      !isPhoneValueAccepted(acceptedPhoneValues[getFieldKey(field)], fieldValue)
    ) {
      throw new Error("Enter a valid phone number before continuing.");
    }

    return collectSimpleFieldValue(field, fieldValue);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-0 sm:bottom-4 sm:px-4">
      <section className="max-h-[min(86svh,640px)] w-full overflow-y-auto rounded-t-xl border border-[var(--auth-input-border)] bg-card p-4 shadow-2xl sm:max-w-3xl sm:rounded-xl sm:p-5">
        <div
          className={cn(
            "flex items-end justify-between gap-3",
            isSignatureField ? "mb-3.5 md:mb-4" : "mb-2 justify-end",
          )}
        >
          {isSignatureField ? (
            <h2 className="min-w-0 flex-1 truncate text-xl font-medium text-[var(--auth-primary)] sm:text-2xl">
              {title}
            </h2>
          ) : null}
          <div className="flex flex-none items-center justify-end gap-2">
            {isSignatureField ? (
              shouldUseSavedSignature ? (
                <>
                  {canTypeSignature ? (
                    <ModeButton
                      active={false}
                      icon={<TypeIcon data-icon="inline-start" />}
                      label="Type"
                      onClick={() => {
                        setIsSavedAssetDismissed(true);
                        setInvalidFieldKey(null);
                        setSignatureDrawDataUrl("");
                        previewSignatureAttachment(null);
                        setMode("type");
                      }}
                    />
                  ) : null}
                  <ModeButton
                    active={false}
                    icon={<ImageUpIcon data-icon="inline-start" />}
                    label="Upload"
                    onClick={() => {
                      setIsSavedAssetDismissed(true);
                      setInvalidFieldKey(null);
                      setSignatureDrawDataUrl("");
                      previewSignatureAttachment(null);
                      setMode("upload");
                    }}
                  />
                  <ModeButton
                    active={false}
                    icon={<RotateCcwIcon data-icon="inline-start" />}
                    label="Redraw"
                    onClick={() => {
                      setIsSavedAssetDismissed(true);
                      setInvalidFieldKey(null);
                      setSignatureDrawDataUrl("");
                      previewSignatureAttachment(null);
                      setMode("draw");
                      queueMicrotask(() => signaturePadRef.current?.clear());
                    }}
                  />
                </>
              ) : (
                <>
                  <ModeButton
                    active={mode === "draw"}
                    icon={<PenLineIcon data-icon="inline-start" />}
                    label="Draw"
                    onClick={() => {
                      setInvalidFieldKey(null);
                      setMode("draw");
                    }}
                  />
                  {canTypeSignature ? (
                    <ModeButton
                      active={mode === "type"}
                      icon={<TypeIcon data-icon="inline-start" />}
                      label="Type"
                      onClick={() => {
                        setInvalidFieldKey(null);
                        setMode("type");
                      }}
                    />
                  ) : null}
                  <ModeButton
                    active={mode === "upload"}
                    icon={<ImageUpIcon data-icon="inline-start" />}
                    label="Upload"
                    onClick={() => {
                      setInvalidFieldKey(null);
                      setMode("upload");
                    }}
                  />
                  <ModeButton
                    active={mode === "phone"}
                    className="hidden md:inline-flex"
                    icon={<QrCodeIcon data-icon="inline-start" />}
                    label="Phone"
                    onClick={() => {
                      setInvalidFieldKey(null);
                      setMode("phone");
                    }}
                  />
                </>
              )
            ) : null}
            <Button
              aria-label="Minimize"
              className="size-9 rounded-full text-[var(--auth-primary)] hover:bg-[var(--auth-muted)]"
              onClick={() => setIsMinimized(true)}
              type="button"
              variant="ghost"
            >
              <Minimize2Icon data-icon="icon-only" />
            </Button>
          </div>
        </div>

        {isSignatureField ? (
          <div className="mx-auto flex w-full max-w-[582px] flex-col gap-3">
            <SignatureInput
              isInvalid={isInvalid}
              mode={mode}
              mobileUrl={
                selectedField.uuid
                  ? getMobileSignatureUrl(
                      form.submitter.slug,
                      selectedField.uuid,
                    )
                  : ""
              }
              onClear={() => signaturePadRef.current?.clear()}
              onHideQr={() => setMode("draw")}
              onFileChange={(file) => {
                setInvalidFieldKey(null);
                setUploadedFiles(file ? [file] : []);
                previewSignatureFile(file);
              }}
              padRef={signaturePadRef}
              qrCanvasRef={qrCanvasRef}
              remoteAttachment={remoteSignatureAttachment}
              savedAsset={shouldUseSavedSignature ? savedSignatureAsset : null}
              signatureDrawDataUrl={signatureDrawDataUrl}
              typedSignature={typedSignature}
              uploadedFile={uploadedFiles[0] ?? null}
              onDrawChange={() => {
                setInvalidFieldKey(null);
                previewSignatureDrawing();
              }}
              onTypedSignatureChange={(value) => {
                setInvalidFieldKey(null);
                setTypedSignature(value);
                void previewTypedSignature(value);
              }}
            />
            {form.configs.require_signing_reason ? (
              <Field>
                <FieldLabel>Signing reason</FieldLabel>
                <Textarea
                  className="min-h-20 rounded-2xl border-[var(--auth-input-border)] bg-white px-4 py-3 shadow-none focus-visible:ring-0"
                  onChange={(event) => setSigningReason(event.target.value)}
                  placeholder="Reason for signing"
                  value={signingReason}
                />
              </Field>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[582px]">
            <SignerFieldInput
              field={selectedField}
              attachmentsIndex={attachmentsIndex}
              attachmentValueUuids={attachmentValueUuids}
              form={form}
              selectedOptions={selectedOptions}
              isInvalid={isInvalid}
              uploadedFiles={uploadedFiles}
              value={fieldValue}
              onAttachmentValueUuidsChange={(value) => {
                setInvalidFieldKey(null);
                setAttachmentValueUuids(value);
                previewFieldValue(value);
              }}
              onFormChange={onFormChange}
              phoneAcceptance={{
                acceptedValue: acceptedPhoneValues[activeFieldKey],
                verifiedValue: verifiedPhoneValues[activeFieldKey],
                onAccept: (phone) =>
                  setAcceptedPhoneValues((previous) => ({
                    ...previous,
                    [activeFieldKey]: phone,
                  })),
                onVerify: (phone) => {
                  setAcceptedPhoneValues((previous) => ({
                    ...previous,
                    [activeFieldKey]: phone,
                  }));
                  setVerifiedPhoneValues((previous) => ({
                    ...previous,
                    [activeFieldKey]: phone,
                  }));
                },
              }}
              onFilesChange={(files) => {
                setInvalidFieldKey(null);
                setUploadedFiles(files);
              }}
              onChange={(value) => {
                setInvalidFieldKey(null);
                setFieldValue(value);
                previewFieldValue(value);
              }}
              onSelectedOptionsChange={(value) => {
                setInvalidFieldKey(null);
                setSelectedOptions(value);
                previewFieldValue(value);
              }}
            />
          </div>
        )}

        {isReadyToComplete ? (
          <p className="mt-2 text-center text-xs text-[var(--auth-muted-foreground)] sm:mt-2.5">
            By clicking &quot;Sign and Complete&quot;, you agree to the{" "}
            <span className="sm:hidden">eSignature Disclosure</span>
            <span className="hidden sm:inline">
              Electronic Signature Disclosure
            </span>
            .
          </p>
        ) : null}
        <Button
          className="mx-auto mt-3 flex h-12 w-full max-w-[582px] rounded-full bg-[var(--auth-primary)] text-sm font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
          disabled={isSaving}
          onClick={() => void saveActiveField()}
          type="button"
        >
          {isSaving ? (
            <Spinner className="size-4" />
          ) : (
            <CheckIcon data-icon="inline-start" />
          )}
          {isReadyToComplete ? "SIGN AND COMPLETE" : "SAVE AND NEXT"}
        </Button>
        <SigningStepDots
          activeIndex={activeStepIndex}
          fields={editableFields}
          onSelectField={selectFieldAfterValidation}
        />
      </section>
    </div>
  );
}

function getSigningStepIndex(
  fields: SigningField[],
  activeField: SigningField,
): number {
  const index = fields.findIndex(
    (field) => getFieldKey(field) === getFieldKey(activeField),
  );

  return Math.max(0, index);
}

function getNextEditableField(
  fields: SigningField[],
  activeField: SigningField,
): SigningField | null {
  const currentIndex = fields.findIndex(
    (field) => getFieldKey(field) === getFieldKey(activeField),
  );

  if (currentIndex < 0) {
    return fields[0] ?? null;
  }

  return fields[currentIndex + 1] ?? null;
}

function SigningStepDots({
  activeIndex,
  fields,
  onSelectField,
}: {
  activeIndex: number;
  fields: SigningField[];
  onSelectField: (field: SigningField) => void;
}) {
  const stepFields = fields.length ? fields : [];
  const total = Math.max(stepFields.length + 1, 1);
  const finalStepIndex = total - 1;

  return (
    <div
      aria-label={`Step ${activeIndex + 1} of ${total}`}
      className="mt-4 flex justify-center gap-2"
      role="status"
    >
      {Array.from({ length: total }).map((_, index) => {
        const field = stepFields[index];
        const isFinalStep = index === finalStepIndex;
        const isActive = index === activeIndex;
        const label =
          field?.name ||
          field?.title ||
          (field ? getDefaultFieldTitle(field) : "Field");

        return (
          <button
            aria-current={isActive ? "step" : undefined}
            aria-label={isFinalStep ? "Completion step" : `Go to ${label}`}
            className={cn(
              "size-2.5 rounded-full border border-[var(--auth-primary)]/20 transition",
              isActive ? "bg-[var(--auth-primary)]" : "bg-[var(--auth-muted)]",
              isFinalStep
                ? "cursor-default opacity-70"
                : "hover:border-[var(--auth-primary)] hover:bg-[var(--auth-primary)]/30",
            )}
            disabled={isFinalStep || !field}
            key={index}
            onClick={() => {
              if (field) {
                onSelectField(field);
              }
            }}
            type="button"
          />
        );
      })}
    </div>
  );
}

function SignatureInput({
  isInvalid,
  mobileUrl,
  mode,
  onClear,
  onDrawChange,
  onFileChange,
  onHideQr,
  onTypedSignatureChange,
  padRef,
  qrCanvasRef,
  remoteAttachment,
  savedAsset,
  signatureDrawDataUrl,
  typedSignature,
  uploadedFile,
}: {
  isInvalid: boolean;
  mobileUrl: string;
  mode: SignatureMode;
  onClear: () => void;
  onDrawChange: () => void;
  onFileChange: (file: File | null) => void;
  onHideQr: () => void;
  onTypedSignatureChange: (value: string) => void;
  padRef: React.MutableRefObject<SignatureCanvasType | null>;
  qrCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  remoteAttachment: SigningAttachment | null;
  savedAsset: SavedSignatureAsset | null;
  signatureDrawDataUrl: string;
  typedSignature: string;
  uploadedFile: File | null;
}) {
  useEffect(() => {
    if (
      mode !== "draw" ||
      remoteAttachment ||
      savedAsset ||
      !signatureDrawDataUrl
    ) {
      return;
    }

    const pad = padRef.current;

    if (!pad || !pad.isEmpty()) {
      return;
    }

    pad.fromDataURL(signatureDrawDataUrl);
  }, [mode, padRef, remoteAttachment, savedAsset, signatureDrawDataUrl]);

  if (mode === "type") {
    return (
      <Input
        className="h-24 rounded-2xl border-[var(--auth-input-border)] px-5 text-4xl shadow-none focus-visible:ring-0 sm:h-28 sm:px-6 sm:text-5xl"
        onChange={(event) => onTypedSignatureChange(event.target.value)}
        style={{ fontFamily: '"Dancing Script", cursive' }}
        value={typedSignature}
      />
    );
  }

  if (mode === "upload") {
    return (
      <label className="flex h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--auth-input-border)] bg-[var(--auth-muted)] text-center sm:h-48">
        <ImageUpIcon className="size-8 text-[var(--auth-primary)]" />
        <span className="text-sm font-semibold">
          {uploadedFile?.name ?? "Upload a signature image"}
        </span>
        <input
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          type="file"
        />
      </label>
    );
  }

  if (mode === "phone") {
    return (
      <div className="flex flex-col gap-2">
        <div className="relative h-44 overflow-hidden rounded-2xl border border-[var(--auth-input-border)] bg-white p-0.5 sm:h-48">
          <div className="absolute inset-0 rounded-2xl bg-white" />
          <div className="absolute inset-0 rounded-2xl bg-[var(--auth-muted)]" />
          <Button
            aria-label="Close phone signing"
            className="absolute right-3 top-3 size-9 rounded-full bg-white/90 text-[var(--auth-primary)] shadow-sm hover:bg-white"
            onClick={onHideQr}
            type="button"
            variant="ghost"
          >
            <XIcon data-icon="icon-only" />
          </Button>
          <div className="relative flex h-full items-center justify-center p-4">
            <div className="flex h-full max-h-40 items-center justify-center rounded-xl bg-white p-4 shadow-sm">
              <canvas
                aria-label="QR code to sign on phone"
                className="h-full w-auto"
                height={132}
                ref={qrCanvasRef}
                width={132}
              />
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-[var(--auth-muted-foreground)]">
          Scan the QR code with the camera app to open the form on mobile and
          draw your signature.
        </p>
        <a
          className="text-center text-xs font-semibold text-[var(--auth-primary)] underline underline-offset-4 md:hidden"
          href={mobileUrl}
        >
          Open on this device
        </a>
      </div>
    );
  }

  if (remoteAttachment) {
    return (
      <div
        className={cn(
          "flex h-44 items-center justify-center rounded-2xl border border-[var(--auth-input-border)] bg-white p-4 sm:h-48",
          isInvalid && "border-red-500 ring-2 ring-red-500/25",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={remoteAttachment.filename}
          className="max-h-full max-w-full object-contain"
          src={remoteAttachment.url}
        />
      </div>
    );
  }

  if (savedAsset) {
    return (
      <div
        className={cn(
          "relative h-44 overflow-hidden rounded-2xl border border-[var(--auth-input-border)] bg-white sm:h-48",
          isInvalid && "border-red-500 ring-2 ring-red-500/25",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={savedAsset.filename}
          className="h-full w-full object-contain px-4 py-3"
          src={savedAsset.url}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative h-44 overflow-hidden rounded-2xl border border-[var(--auth-input-border)] bg-white sm:h-48",
        isInvalid && "border-red-500 ring-2 ring-red-500/25",
      )}
    >
      <SignatureCanvas
        canvasProps={{
          className: "h-full w-full touch-none",
          onMouseUp: onDrawChange,
          onTouchEnd: onDrawChange,
        }}
        penColor="#16304f"
        canvasRef={padRef}
        throttle={8}
      />
      <Button
        aria-label="Clear signature"
        className="absolute right-3 top-3 h-8 rounded-full bg-white/90 px-3 text-xs font-bold text-[var(--auth-primary)] shadow-sm hover:bg-[var(--auth-muted)] md:h-9"
        onClick={() => {
          onClear();
          onDrawChange();
        }}
        type="button"
        variant="ghost"
      >
        <RotateCcwIcon data-icon="inline-start" />
        REDRAW
      </Button>
    </div>
  );
}

function SignerFieldInput({
  attachmentValueUuids,
  attachmentsIndex,
  field,
  form,
  isInvalid,
  onAttachmentValueUuidsChange,
  onChange,
  onFormChange,
  phoneAcceptance,
  onFilesChange,
  onSelectedOptionsChange,
  selectedOptions,
  uploadedFiles,
  value,
}: {
  attachmentValueUuids: string[];
  attachmentsIndex: Record<string, { filename: string; url: string }>;
  field: SigningField;
  form: SigningForm;
  isInvalid: boolean;
  onAttachmentValueUuidsChange: (value: string[]) => void;
  onChange: (value: string) => void;
  onFormChange: (form: SigningForm) => void;
  phoneAcceptance: PhoneAcceptance;
  onFilesChange: (files: File[]) => void;
  onSelectedOptionsChange: (value: string[]) => void;
  selectedOptions: string[];
  uploadedFiles: File[];
  value: string;
}) {
  if (field.type === "phone") {
    return (
      <PhoneFieldInput
        field={field}
        form={form}
        isInvalid={isInvalid}
        value={value}
        onFormChange={onFormChange}
        onChange={onChange}
        acceptance={phoneAcceptance}
      />
    );
  }

  if (field.type === "checkbox") {
    const label =
      field.description || field.name || getDefaultFieldTitle(field);

    return (
      <FieldGroup>
        <Field>
          <FieldLabel className="sr-only">{label}</FieldLabel>
          <div className="mx-auto flex w-fit items-center gap-3">
            <Checkbox
              checked={value === "true"}
              className={cn(
                "size-7 rounded border-[var(--auth-input-border)] data-[state=checked]:border-[var(--auth-primary)] data-[state=checked]:bg-[var(--auth-primary)] data-[state=checked]:text-[var(--auth-primary-foreground)]",
                isInvalid && "border-red-500 ring-2 ring-red-500/30",
              )}
              onCheckedChange={(checked) => onChange(checked ? "true" : "")}
            />
            <span className="text-2xl font-normal leading-none text-[var(--auth-primary)]">
              {label}
            </span>
          </div>
        </Field>
      </FieldGroup>
    );
  }

  if (
    field.type === "image" ||
    field.type === "file" ||
    field.type === "stamp"
  ) {
    return (
      <AttachmentFieldInput
        attachmentValueUuids={attachmentValueUuids}
        attachmentsIndex={attachmentsIndex}
        field={field}
        files={uploadedFiles}
        isInvalid={isInvalid}
        value={value}
        onAttachmentValueUuidsChange={onAttachmentValueUuidsChange}
        onChange={onChange}
        onFilesChange={onFilesChange}
      />
    );
  }

  if (field.type === "select") {
    return (
      <OptionSelectInput
        field={field}
        isInvalid={isInvalid}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (field.type === "radio") {
    return (
      <OptionToggleInput
        field={field}
        isInvalid={isInvalid}
        type="single"
        value={value}
        onChange={onChange}
      />
    );
  }

  if (field.type === "multiple") {
    return (
      <OptionToggleInput
        field={field}
        isInvalid={isInvalid}
        selectedOptions={selectedOptions}
        type="multiple"
        onSelectedOptionsChange={onSelectedOptionsChange}
      />
    );
  }

  return (
    <TextLikeFieldInput
      field={field}
      isInvalid={isInvalid}
      value={value}
      onChange={onChange}
    />
  );
}

function AttachmentFieldInput({
  attachmentValueUuids,
  attachmentsIndex,
  field,
  files,
  isInvalid,
  onAttachmentValueUuidsChange,
  onChange,
  onFilesChange,
  value,
}: {
  attachmentValueUuids: string[];
  attachmentsIndex: Record<string, { filename: string; url: string }>;
  field: SigningField;
  files: File[];
  isInvalid: boolean;
  onAttachmentValueUuidsChange: (value: string[]) => void;
  onChange: (value: string) => void;
  onFilesChange: (files: File[]) => void;
  value: string;
}) {
  const isImage = field.type === "image" || field.type === "stamp";
  const existingImage = isImage && value ? attachmentsIndex[value] : null;
  const localImageFile = isImage ? files[0] : null;

  return (
    <FieldGroup>
      <Field>
        {isImage && (existingImage || localImageFile) ? (
          <UploadedImagePreview
            attachment={existingImage}
            file={localImageFile}
            label={field.name || getDefaultFieldTitle(field)}
            onRemove={() => {
              onChange("");
              onFilesChange([]);
            }}
          />
        ) : null}
        {!isImage && (attachmentValueUuids.length || files.length) ? (
          <UploadedFileList
            attachmentsIndex={attachmentsIndex}
            files={files}
            valueUuids={attachmentValueUuids}
            onFilesChange={onFilesChange}
            onValueUuidsChange={onAttachmentValueUuidsChange}
          />
        ) : null}
        <label
          className={cn(
            "flex h-40 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--auth-input-border)] bg-[var(--auth-muted)] px-4 text-center transition hover:border-[var(--auth-primary)] hover:bg-[var(--auth-primary)]/5",
            isInvalid && "border-red-500 bg-red-50 ring-2 ring-red-500/25",
          )}
        >
          {isImage ? (
            <ImageUpIcon className="size-8 text-[var(--auth-primary)]" />
          ) : (
            <PaperclipIcon className="size-8 text-[var(--auth-primary)]" />
          )}
          <span className="text-sm font-semibold">
            {isImage && (existingImage || localImageFile)
              ? "Reupload"
              : getUploadMessage(field)}
          </span>
          <span className="text-xs text-[var(--auth-muted-foreground)]">
            Click to upload or drag and drop files
          </span>
          <input
            accept={getAttachmentAccept(field)}
            className="sr-only"
            multiple={field.type === "file"}
            onChange={(event) =>
              onFilesChange(Array.from(event.target.files ?? []))
            }
            type="file"
          />
        </label>
        {field.description ? (
          <FieldDescription>{field.description}</FieldDescription>
        ) : null}
      </Field>
    </FieldGroup>
  );
}

function UploadedImagePreview({
  attachment,
  file,
  label,
  onRemove,
}: {
  attachment: { filename: string; url: string } | null;
  file: File | null;
  label: string;
  onRemove: () => void;
}) {
  const localPreviewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );

  useEffect(
    () => () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    },
    [localPreviewUrl],
  );

  const previewUrl = localPreviewUrl ?? attachment?.url;

  if (!previewUrl) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <FieldLabel>{label}</FieldLabel>
        <Button
          className="h-8 rounded-full px-3 text-xs font-bold"
          onClick={onRemove}
          type="button"
          variant="outline"
        >
          <RotateCcwIcon data-icon="inline-start" />
          Reupload
        </Button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={file?.name ?? attachment?.filename ?? label}
        className="mx-auto h-52 max-w-full rounded-lg border border-[var(--auth-input-border)] bg-white object-contain"
        src={previewUrl}
      />
    </div>
  );
}

function UploadedFileList({
  attachmentsIndex,
  files,
  onFilesChange,
  onValueUuidsChange,
  valueUuids,
}: {
  attachmentsIndex: Record<string, { filename: string; url: string }>;
  files: File[];
  onFilesChange: (files: File[]) => void;
  onValueUuidsChange: (value: string[]) => void;
  valueUuids: string[];
}) {
  const existingAttachments = valueUuids
    .map((uuid) => ({ attachment: attachmentsIndex[uuid], uuid }))
    .filter(
      (
        item,
      ): item is {
        attachment: { filename: string; url: string };
        uuid: string;
      } => Boolean(item.attachment),
    );

  return (
    <div className="flex flex-col gap-2">
      {[...existingAttachments].map(({ attachment, uuid }) => (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border border-[var(--auth-input-border)] bg-white px-3 py-2 text-sm"
          key={uuid}
        >
          <a
            className="min-w-0 truncate font-semibold text-[var(--auth-primary)] underline-offset-4 hover:underline"
            href={attachment.url}
            rel="noreferrer"
            target="_blank"
          >
            <PaperclipIcon data-icon="inline-start" />
            {attachment.filename}
          </a>
          <Button
            aria-label={`Remove ${attachment.filename}`}
            className="size-8 shrink-0 rounded-full"
            onClick={() =>
              onValueUuidsChange(valueUuids.filter((item) => item !== uuid))
            }
            type="button"
            variant="ghost"
          >
            <Trash2Icon data-icon="icon-only" />
          </Button>
        </div>
      ))}
      {files.map((file, index) => (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border border-[var(--auth-input-border)] bg-white px-3 py-2 text-sm"
          key={`${file.name}-${file.lastModified}-${index}`}
        >
          <span className="min-w-0 truncate font-semibold">
            <PaperclipIcon data-icon="inline-start" />
            {file.name}
          </span>
          <Button
            aria-label={`Remove ${file.name}`}
            className="size-8 shrink-0 rounded-full"
            onClick={() =>
              onFilesChange(files.filter((_, fileIndex) => fileIndex !== index))
            }
            type="button"
            variant="ghost"
          >
            <Trash2Icon data-icon="icon-only" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function TextLikeFieldInput({
  field,
  isInvalid,
  onChange,
  value,
}: {
  field: SigningField;
  isInvalid: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const [isMultiline, setIsMultiline] = useState(false);

  if (field.type === "date") {
    return (
      <DateFieldInput
        field={field}
        isInvalid={isInvalid}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (field.type === "payment") {
    return (
      <FieldGroup>
        <Field className="rounded-2xl border border-[var(--auth-input-border)] bg-[var(--auth-muted)] p-4">
          <FieldLabel>Payment step</FieldLabel>
          <FieldDescription>
            Payment collection needs the DocuSeal-compatible payment provider
            flow before this field can be completed.
          </FieldDescription>
        </Field>
      </FieldGroup>
    );
  }

  const canToggleMultiline =
    field.type === "text" && !field.validation?.pattern;
  const maxLength = getCellsMaxLength(field);

  return (
    <FieldGroup className="gap-3">
      <Field className="gap-3">
        {field.description ? (
          <FieldDescription>{field.description}</FieldDescription>
        ) : null}
        {isMultiline ? (
          <Textarea
            className={cn(
              "min-h-32 rounded-2xl border-[var(--auth-input-border)] px-5 py-4 text-2xl shadow-none focus-visible:ring-0",
              isInvalid && "border-red-500 ring-2 ring-red-500/25",
            )}
            maxLength={maxLength}
            onChange={(event) => onChange(event.target.value)}
            placeholder={field.name || getDefaultFieldTitle(field)}
            value={value}
          />
        ) : (
          <div className="relative">
            <Input
              className={cn(
                "h-12 rounded-full border-[var(--auth-input-border)] bg-white px-5 pr-14 text-2xl shadow-none placeholder:text-muted-foreground/65 focus-visible:ring-0 sm:h-14",
                isInvalid && "border-red-500 ring-2 ring-red-500/25",
              )}
              inputMode={getInputMode(field)}
              max={getValidationNumber(field, "max")}
              maxLength={maxLength}
              min={getValidationNumber(field, "min")}
              onChange={(event) => onChange(event.target.value)}
              pattern={getValidationPattern(field)}
              placeholder={field.name || getDefaultFieldTitle(field)}
              step={getValidationNumber(field, "step")}
              type={getInputType(field)}
              value={value}
            />
            {canToggleMultiline ? (
              <Button
                aria-label="Use multiple lines"
                className="absolute right-4 top-1/2 size-7 -translate-y-1/2 rounded-none border-0 bg-transparent p-0 text-[var(--auth-primary)] shadow-none hover:bg-transparent hover:text-[var(--auth-primary-hover)]"
                onClick={() => setIsMultiline(true)}
                type="button"
                variant="ghost"
              >
                <FileTextIcon className="size-6" data-icon="icon-only" />
              </Button>
            ) : null}
          </div>
        )}
        {canToggleMultiline && isMultiline ? (
          <Button
            className="mx-auto h-9 rounded-full px-4 text-xs font-bold"
            onClick={() => setIsMultiline((current) => !current)}
            type="button"
            variant="outline"
          >
            Use single line
          </Button>
        ) : null}
      </Field>
    </FieldGroup>
  );
}

function PhoneFieldInput({
  acceptance,
  field,
  form,
  isInvalid,
  onChange,
  onFormChange,
  value,
}: {
  acceptance: PhoneAcceptance;
  field: SigningField;
  form: SigningForm;
  isInvalid: boolean;
  onChange: (value: string) => void;
  onFormChange: (form: SigningForm) => void;
  value: string;
}) {
  const [code, setCode] = useState("");
  const [isAccepting, setIsAccepting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationSentTo, setVerificationSentTo] = useState<string | null>(
    null,
  );
  const fixedCountry = getPhoneFieldCountry(field);
  const detectedCountry = fixedCountry ?? getPhoneCountry(value);
  const [countryIso, setCountryIso] = useState(
    detectedCountry?.iso ?? getDefaultPhoneCountry().iso,
  );
  const [countryDialCode, setCountryDialCode] = useState(
    detectedCountry?.dial ?? getDefaultPhoneCountry().dial,
  );
  const selectedCountry =
    fixedCountry ??
    phoneCountries.find((country) => country.iso === countryIso) ??
    phoneCountries.find((country) => country.dial === countryDialCode) ??
    phoneCountries[0];
  const selectedCountryCode = selectedCountry.iso.toUpperCase() as CountryCode;
  const phoneValidation = getPhoneValidationState(value, selectedCountryCode);
  const nationalValue = getNationalPhoneValue(value, selectedCountry.dial);
  const examplePlaceholder = getPhonePlaceholder(selectedCountryCode);
  const isPhoneAccepted = isPhoneValueAccepted(acceptance.acceptedValue, value);

  function updatePhone(nextCountryDialCode: string, nextNationalValue: string) {
    const cleanedNationalValue = nextNationalValue.replace(/^\+/, "");
    const nextCountry =
      phoneCountries.find((country) => country.dial === nextCountryDialCode) ??
      selectedCountry;
    const formatter = new AsYouType(
      nextCountry.iso.toUpperCase() as CountryCode,
    );
    const formattedValue = formatter.input(
      cleanedNationalValue.replace(/[^\d]/g, ""),
    );

    onChange(
      cleanedNationalValue
        ? `+${nextCountryDialCode}${formattedValue.replace(/[^\d]/g, "")}`
        : "",
    );
  }

  async function acceptValidatedPhone() {
    if (!phoneValidation.isValid || !phoneValidation.e164) {
      toast.error("Phone number is invalid", {
        description: `Enter a valid ${selectedCountry.name} phone number.`,
      });
      return;
    }

    setIsAccepting(true);

    try {
      const result = await validateSigningPhoneNumber(form.submitter.slug, {
        field_uuid: field.uuid,
        phone: phoneValidation.e164,
      });

      if (!result.valid) throw new Error("Phone number is invalid.");
      acceptance.onAccept(result.phone);
      onChange(result.phone);
      onFormChange({
        ...form,
        values: {
          ...form.values,
          [getFieldKey(field)]: result.phone,
        },
      });
      toast.success("Phone number accepted");
    } catch (error) {
      toast.error("Phone number is invalid", {
        description:
          error instanceof Error
            ? error.message
            : `Enter a valid ${selectedCountry.name} phone number.`,
      });
    } finally {
      setIsAccepting(false);
    }
  }

  async function sendCode() {
    setIsSending(true);

    try {
      const result = await sendSigningPhoneVerification(form.submitter.slug, {
        field_uuid: field.uuid,
        phone: value,
      });

      setVerificationSentTo(result.phone);
      toast.success("Verification code sent");
    } catch (error) {
      toast.error("Phone verification failed", {
        description:
          error instanceof Error ? error.message : "Unable to send SMS code.",
      });
    } finally {
      setIsSending(false);
    }
  }

  async function verifyCode() {
    setIsVerifying(true);

    try {
      const verifiedForm = await verifySigningPhoneCode(form.submitter.slug, {
        code,
        field_uuid: field.uuid,
        phone: value,
      });
      const verifiedPhone = verifiedForm.values[getFieldKey(field)];
      acceptance.onVerify(
        typeof verifiedPhone === "string"
          ? verifiedPhone
          : phoneValidation.e164,
      );
      onFormChange(verifiedForm);
      toast.success("Phone verified");
    } catch (error) {
      toast.error("Phone verification failed", {
        description:
          error instanceof Error
            ? error.message
            : "Check the code and try again.",
      });
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <FieldGroup>
      <Field>
        {field.description ? (
          <FieldDescription>{field.description}</FieldDescription>
        ) : null}
        <div
          className={cn(
            "flex h-14 items-stretch overflow-hidden rounded-full border bg-white focus-within:ring-2 focus-within:ring-[var(--auth-ring)]",
            value && !phoneValidation.isValid
              ? "border-red-300"
              : "border-[var(--auth-input-border)]",
            isInvalid && "border-red-500 ring-2 ring-red-500/25",
          )}
        >
          <PhoneCountryPicker
            disabled={Boolean(fixedCountry)}
            onChange={(country) => {
              setCountryIso(country.iso);
              setCountryDialCode(country.dial);
              updatePhone(country.dial, nationalValue);
            }}
            selectedCountry={selectedCountry}
          />
          <Input
            className="h-full rounded-none border-0 px-5 text-xl shadow-none focus-visible:ring-0"
            inputMode="tel"
            onChange={(event) =>
              updatePhone(countryDialCode, event.target.value)
            }
            placeholder={examplePlaceholder}
            type="tel"
            value={nationalValue}
          />
        </div>
        <FieldDescription
          className={cn(
            "flex items-center gap-1.5",
            value && !phoneValidation.isValid ? "text-red-600" : "",
            isPhoneAccepted ? "text-emerald-700" : "",
          )}
        >
          {isPhoneAccepted ? (
            <>
              <CheckIcon className="size-4" />
              Phone number is valid
              {isSamePhoneValue(acceptance.verifiedValue, value)
                ? " and verified"
                : ""}
              .
            </>
          ) : value && !phoneValidation.isValid ? (
            `Enter a valid ${selectedCountry.name} number, for example ${examplePlaceholder}.`
          ) : fixedCountry ? (
            `Use a valid ${selectedCountry.name} number.`
          ) : (
            `Use a ${selectedCountry.name} number in local format.`
          )}
        </FieldDescription>
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--auth-input-border)] bg-[var(--auth-muted)] p-3 sm:flex-row">
          <Button
            className="h-11 rounded-full px-5 font-bold"
            disabled={
              !phoneValidation.isValid || isPhoneAccepted || isAccepting
            }
            onClick={() => void acceptValidatedPhone()}
            type="button"
            variant="outline"
          >
            {isAccepting
              ? "Checking..."
              : isPhoneAccepted
                ? "Accepted"
                : "Use valid number"}
          </Button>
          <Button
            className="h-11 rounded-full px-5 font-bold"
            disabled={!phoneValidation.isValid || isSending}
            onClick={() => void sendCode()}
            type="button"
            variant="outline"
          >
            {isSending ? "Sending..." : "Send SMS code"}
          </Button>
          <Input
            className="h-11 rounded-full border-[var(--auth-input-border)] bg-white px-4 shadow-none focus-visible:ring-0"
            inputMode="numeric"
            maxLength={8}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Code"
            value={code}
          />
          <Button
            className="h-11 rounded-full px-5 font-bold"
            disabled={!code || isVerifying}
            onClick={() => void verifyCode()}
            type="button"
          >
            {isVerifying ? "Verifying..." : "Verify"}
          </Button>
        </div>
        {verificationSentTo ? (
          <FieldDescription>
            Verification code sent to {verificationSentTo}.
          </FieldDescription>
        ) : null}
      </Field>
    </FieldGroup>
  );
}

function DateFieldInput({
  field,
  isInvalid,
  onChange,
  value,
}: {
  field: SigningField;
  isInvalid: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const inputType = getDateInputType(field);
  const inputValue = getDateInputValue(value, inputType);
  const todayValue = getTodayInputValue(inputType);

  return (
    <FieldGroup>
      <Field className="gap-3">
        <div className="flex items-center justify-between gap-3 px-1">
          <FieldLabel className="sr-only">
            {field.name || getDefaultFieldTitle(field)}
          </FieldLabel>
          <span className="text-2xl font-medium text-[var(--auth-primary)]">
            {field.description || field.name || getDefaultFieldTitle(field)}
          </span>
          {canSetToday(field, inputType) ? (
            <Button
              className="h-9 rounded-full border-[var(--auth-primary)] px-4 text-sm font-medium text-[var(--auth-primary)]"
              onClick={() => onChange(todayValue)}
              type="button"
              variant="outline"
            >
              <CalendarCheckIcon data-icon="inline-start" />
              Set today
            </Button>
          ) : null}
        </div>
        <Input
          className={cn(
            "h-12 rounded-full border-[var(--auth-input-border)] bg-white px-5 text-center text-2xl shadow-none placeholder:text-muted-foreground/65 focus-visible:ring-0 sm:h-14",
            isInvalid && "border-red-500 ring-2 ring-red-500/25",
          )}
          max={getDateValidationValue(field, "max", inputType)}
          min={getDateValidationValue(field, "min", inputType)}
          onChange={(event) => {
            const nextValue = event.target.value;

            if (inputType === "datetime-local" && nextValue) {
              const date = new Date(nextValue);
              onChange(
                Number.isNaN(date.valueOf()) ? nextValue : date.toISOString(),
              );
              return;
            }

            onChange(nextValue);
          }}
          type={inputType}
          value={inputValue}
        />
      </Field>
    </FieldGroup>
  );
}

function OptionSelectInput({
  field,
  isInvalid,
  onChange,
  value,
}: {
  field: SigningField;
  isInvalid: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const options = getFieldOptions(field);

  return (
    <FieldGroup>
      <Field>
        <FieldLabel className="sr-only">
          {field.name || "Select option"}
        </FieldLabel>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger
            className={cn(
              "h-12 w-full rounded-full border-[var(--auth-input-border)] px-5 text-center text-2xl shadow-none sm:h-14",
              isInvalid && "border-red-500 ring-2 ring-red-500/25",
            )}
          >
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.uuid} value={option.value}>
                  {option.value}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </FieldGroup>
  );
}

function OptionToggleInput({
  field,
  isInvalid,
  onChange,
  onSelectedOptionsChange,
  selectedOptions,
  type,
  value,
}: {
  field: SigningField;
  isInvalid: boolean;
  onChange?: (value: string) => void;
  onSelectedOptionsChange?: (value: string[]) => void;
  selectedOptions?: string[];
  type: "multiple" | "single";
  value?: string;
}) {
  const options = getFieldOptions(field);

  if (type === "single") {
    return (
      <FieldGroup>
        <Field>
          <FieldLabel className="sr-only">
            {field.name || "Choose option"}
          </FieldLabel>
          <RadioGroup
            className={cn(
              "mx-auto flex w-fit flex-col gap-3",
              options.length > 4 && "max-h-44 overflow-y-auto pr-2",
            )}
            value={value}
            onValueChange={(nextValue: string) => onChange?.(nextValue)}
          >
            {options.map((option) => (
              <label
                className={cn(
                  "flex w-fit cursor-pointer items-center gap-3 rounded-lg",
                  isInvalid && "ring-2 ring-red-500/25",
                )}
                key={option.uuid}
              >
                <RadioGroupItem
                  className={cn(
                    "size-7 border-[var(--auth-input-border)] text-[var(--auth-primary)]",
                    isInvalid && "border-red-500",
                  )}
                  value={option.value}
                />
                <span className="text-2xl font-normal leading-none text-[var(--auth-primary)]">
                  {option.value}
                </span>
              </label>
            ))}
          </RadioGroup>
        </Field>
      </FieldGroup>
    );
  }

  return (
    <FieldGroup>
      <Field>
        <FieldLabel className="sr-only">
          {field.name || "Select options"}
        </FieldLabel>
        <div
          className={cn(
            "mx-auto flex w-fit flex-col gap-3",
            options.length > 4 && "max-h-44 overflow-y-auto pr-2",
          )}
        >
          {options.map((option) => (
            <label
              className={cn(
                "flex w-fit cursor-pointer items-center gap-3 rounded-lg",
                isInvalid && "ring-2 ring-red-500/25",
              )}
              key={option.uuid}
            >
              <Checkbox
                checked={(selectedOptions ?? []).includes(option.value)}
                className={cn(
                  "size-7 rounded border-[var(--auth-input-border)] data-[state=checked]:border-[var(--auth-primary)] data-[state=checked]:bg-[var(--auth-primary)] data-[state=checked]:text-[var(--auth-primary-foreground)]",
                  isInvalid && "border-red-500",
                )}
                onCheckedChange={(checked) => {
                  const current = selectedOptions ?? [];
                  onSelectedOptionsChange?.(
                    checked
                      ? [...current, option.value]
                      : current.filter((item) => item !== option.value),
                  );
                }}
              />
              <span className="text-2xl font-normal leading-none text-[var(--auth-primary)]">
                {option.value}
              </span>
            </label>
          ))}
        </div>
      </Field>
    </FieldGroup>
  );
}

function ModeButton({
  active,
  className,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  className?: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className={cn(
        "size-9 min-w-9 justify-center rounded-full p-0 text-xs font-bold sm:h-9 sm:w-auto sm:px-4",
        active
          ? "bg-[var(--auth-primary)] text-[var(--auth-primary-foreground)]"
          : "border-[var(--auth-primary)] text-[var(--auth-primary)]",
        className,
      )}
      onClick={onClick}
      type="button"
      variant={active ? "default" : "outline"}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

async function typedSignatureToFile(signature: string): Promise<File> {
  await document.fonts.ready;

  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 180;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Signature canvas could not be created.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#16304f";
  context.font = '112px "Dancing Script", cursive';
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillText(signature, canvas.width / 2, 142);

  return dataUrlToFile(canvas.toDataURL("image/png"), "typed-signature.png");
}

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [metadata, base64] = dataUrl.split(",");
  const mimeMatch = metadata.match(/data:(.*);base64/);
  const mimeType = mimeMatch?.[1] ?? "image/png";
  const bytes = window.atob(base64);
  const buffer = new Uint8Array(bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    buffer[index] = bytes.charCodeAt(index);
  }

  return new File([buffer], filename, { type: mimeType });
}

async function remoteImageToFile(asset: SavedSignatureAsset): Promise<File> {
  const response = await fetch(asset.url);

  if (!response.ok) {
    throw new Error("Saved signature could not be loaded.");
  }

  const blob = await response.blob();
  const contentType = asset.content_type || blob.type || "image/png";

  return new File([blob], asset.filename, { type: contentType });
}

function createLocalSigningAttachment(
  uuid: string,
  filename: string,
  contentType: string | null,
  url: string,
): SigningAttachment {
  return {
    content_type: contentType,
    filename,
    url,
    uuid,
  };
}

function clearSignaturePreviewUrl(
  previewUrlRef: React.MutableRefObject<string | null>,
) {
  if (!previewUrlRef.current) {
    return;
  }

  URL.revokeObjectURL(previewUrlRef.current);
  previewUrlRef.current = null;
}

function collectSimpleFieldValue(field: SigningField, value: string): unknown {
  if (field.type === "checkbox") {
    return value === "true";
  }

  if (field.type === "payment") {
    throw new Error("Payment collection is not configured yet.");
  }

  return value;
}

function hasRequiredFieldValue(
  form: SigningForm,
  field: SigningField,
): boolean {
  if (!isRequiredField(field)) {
    return true;
  }

  return hasDraftValue(field, form.values[getFieldKey(field)]);
}

function isRequiredField(field: SigningField): boolean {
  return field.required !== false && field.readonly !== true;
}

function hasDraftValue(field: SigningField, value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (field.type === "checkbox") {
    return value === true || value === "true";
  }

  return value !== null && value !== undefined && value !== "";
}

function getIncompleteFieldsExceptCurrent(
  fields: SigningField[],
  form: SigningForm,
  currentField: SigningField,
): SigningField[] {
  const currentFieldKey = getFieldKey(currentField);

  return fields.filter(
    (field) =>
      isRequiredField(field) &&
      getFieldKey(field) !== currentFieldKey &&
      !hasRequiredFieldValue(form, field),
  );
}

function isSamePhoneValue(
  savedValue: string | undefined,
  value: string,
): boolean {
  return (
    typeof savedValue === "string" &&
    savedValue !== "" &&
    normalizePhoneValue(savedValue) === normalizePhoneValue(value)
  );
}

function isPhoneValueAccepted(
  savedValue: string | undefined,
  value: string,
): boolean {
  return (
    isSamePhoneValue(savedValue, value) &&
    getPhoneValidationState(value).isValid
  );
}

function getSavedPhoneValues(
  fields: SigningField[],
  form: SigningForm,
): Record<string, string> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = form.values[getFieldKey(field)];
      return field.type === "phone" &&
        typeof value === "string" &&
        getPhoneValidationState(value).isValid
        ? [[getFieldKey(field), value]]
        : [];
    }),
  );
}

function getPhoneValidationState(
  value: string,
  country?: CountryCode,
): {
  e164: string;
  isPossible: boolean;
  isValid: boolean;
} {
  const phone = parsePhoneNumberFromString(value, country);

  return {
    e164: phone?.number ?? "",
    isPossible: phone?.isPossible() ?? false,
    isValid: phone?.isValid() ?? false,
  };
}

function getNationalPhoneValue(value: string, dialCode: string): string {
  if (!value) {
    return "";
  }

  const phone = parsePhoneNumberFromString(value);

  if (phone?.nationalNumber) {
    return new AsYouType(phone.country).input(phone.nationalNumber);
  }

  return value.startsWith(`+${dialCode}`)
    ? value.replace(`+${dialCode}`, "")
    : value;
}

function getPhonePlaceholder(country: CountryCode): string {
  const example = getExampleNumber(country, examples);

  return example?.formatNational() ?? "234 567 8900";
}

function normalizePhoneValue(value: string): string {
  return value.replace(/[^+\d]/g, "");
}

function getFieldKey(field: SigningField): string {
  return field.uuid ?? field.name ?? "field";
}

function getDefaultFieldTitle(field: SigningField): string {
  switch (field.type) {
    case "date":
      return "Date";
    case "file":
      return "File";
    case "image":
      return "Image";
    case "initials":
      return "Initials";
    case "multiple":
      return "Multiple choice";
    case "number":
      return "Number";
    case "payment":
      return "Payment";
    case "phone":
      return "Phone";
    case "radio":
      return "Radio";
    case "select":
      return "Select";
    case "signature":
      return "Signature";
    case "stamp":
      return "Stamp";
    case "text":
      return "Text";
    default:
      return "Field";
  }
}

function getFieldOptions(field: SigningField): Array<{
  uuid: string;
  value: string;
}> {
  const rawOptions = getRawFieldOptions(field);

  if (!rawOptions.length) {
    return getAreaFieldOptions(field);
  }

  return rawOptions.map((option, index) => {
    const fallbackUuid = `${field.uuid ?? field.name ?? "field"}-${index}`;
    const optionRecord = isOptionRecord(option) ? option : {};
    const label =
      getOptionString(option) ||
      getOptionString(optionRecord.value) ||
      getOptionString(optionRecord.label) ||
      getOptionString(optionRecord.name) ||
      getOptionString(optionRecord.title) ||
      getOptionString(optionRecord.text);

    return {
      uuid: getOptionString(optionRecord.uuid) || fallbackUuid,
      value: label || `Option ${index + 1}`,
    };
  });
}

function getRawFieldOptions(field: SigningField): unknown[] {
  if (Array.isArray(field.options)) {
    return field.options;
  }

  const preferencesOptions = field.preferences?.options;

  return Array.isArray(preferencesOptions) ? preferencesOptions : [];
}

function getAreaFieldOptions(field: SigningField): Array<{
  uuid: string;
  value: string;
}> {
  return (field.areas ?? [])
    .filter((area) => typeof area.option_uuid === "string")
    .map((area, index) => ({
      uuid:
        area.option_uuid ?? `${field.uuid ?? field.name ?? "field"}-${index}`,
      value: `Option ${index + 1}`,
    }));
}

function isOptionRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getOptionString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getStringFieldValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function getStringArrayFieldValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function getInputType(field: SigningField): string {
  if (field.type === "number") {
    return "number";
  }

  if (field.type === "phone") {
    return "tel";
  }

  return "text";
}

function getInputMode(
  field: SigningField,
): React.HTMLAttributes<HTMLInputElement>["inputMode"] {
  if (field.type === "number") {
    return "decimal";
  }

  if (field.type === "phone") {
    return "tel";
  }

  return undefined;
}

function getAttachmentAccept(field: SigningField): string {
  if (field.type === "image" || field.type === "stamp") {
    return "image/png,image/jpeg,image/webp";
  }

  return "application/pdf,image/*,.doc,.docx,.txt";
}

function getMobileSignatureUrl(
  submitterSlug: string,
  fieldUuid: string,
): string {
  if (typeof window === "undefined") {
    return "";
  }

  const configuredBaseUrl = process.env.NEXT_PUBLIC_SIGNING_BASE_URL?.replace(
    /\/$/,
    "",
  );
  const fieldPrefix = fieldUuid.split("-")[0];
  const baseUrl = configuredBaseUrl || window.location.origin;

  return `${baseUrl}/s/${submitterSlug}?f=${fieldPrefix}`;
}

async function renderQrCode(
  canvas: HTMLCanvasElement | null,
  text: string,
): Promise<void> {
  if (!canvas || !text) {
    return;
  }

  const { default: Qr } = await import("qr-creator");

  Qr.render(
    {
      background: null,
      ecLevel: "H",
      radius: 0,
      size: 132,
      text,
    },
    canvas,
  );
}

function getUploadMessage(field: SigningField): string {
  if (field.type === "image" || field.type === "stamp") {
    return "Upload an image";
  }

  return "Upload files";
}

const phoneCountries = phoneData.map(([iso, name, dial, flag, timezones]) => ({
  dial,
  flag,
  iso,
  name,
  timezones,
}));

type PhoneCountry = (typeof phoneCountries)[number];

function PhoneCountryPicker({
  disabled,
  onChange,
  selectedCountry,
}: {
  disabled: boolean;
  onChange: (country: PhoneCountry) => void;
  selectedCountry: PhoneCountry;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredCountries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return phoneCountries;
    }

    return phoneCountries.filter((country) => {
      const searchable = `${country.name} ${country.iso} +${country.dial}`;

      return searchable.toLowerCase().includes(normalizedQuery);
    });
  }, [query]);

  return (
    <Popover onOpenChange={setOpen} open={open && !disabled}>
      <PopoverTrigger asChild>
        <button
          aria-label="Select phone country"
          className="flex h-full w-32 shrink-0 items-center justify-between gap-2 border-0 border-r border-[var(--auth-input-border)] bg-[var(--auth-muted)] px-4 text-base text-[var(--auth-primary)] disabled:cursor-default"
          disabled={disabled}
          type="button"
        >
          <span className="flex min-w-0 items-center gap-2 leading-none">
            <span className="text-lg leading-none">{selectedCountry.flag}</span>
            <span className="truncate leading-none">
              +{selectedCountry.dial}
            </span>
          </span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 gap-2 rounded-2xl p-2"
        sideOffset={8}
      >
        <div className="flex h-11 items-center gap-2 rounded-full border border-[var(--auth-input-border)] bg-background px-4">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            className="h-full rounded-none border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search country or code"
            value={query}
          />
        </div>
        <div className="max-h-72 overflow-y-auto pr-1">
          {filteredCountries.length ? (
            filteredCountries.map((country) => {
              const isSelected = country.iso === selectedCountry.iso;

              return (
                <button
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--auth-muted)]",
                    isSelected ? "bg-[var(--auth-muted)] font-semibold" : "",
                  )}
                  key={country.iso}
                  onClick={() => {
                    onChange(country);
                    setOpen(false);
                    setQuery("");
                  }}
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="text-lg">{country.flag}</span>
                    <span className="min-w-0">
                      <span className="block truncate">{country.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {country.iso} +{country.dial}
                      </span>
                    </span>
                  </span>
                  {isSelected ? (
                    <CheckIcon className="size-4 shrink-0" />
                  ) : null}
                </button>
              );
            })
          ) : (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No country found.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getPhoneCountry(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  const dialCodes = [...phoneCountries].sort(
    (firstCountry, secondCountry) =>
      secondCountry.dial.length - firstCountry.dial.length,
  );

  return dialCodes.find((country) => digits.startsWith(`+${country.dial}`));
}

function getPhoneFieldCountry(field: SigningField) {
  const country = field.validation?.phone_country;

  if (typeof country !== "string" || !country) {
    return null;
  }

  return (
    phoneCountries.find(
      (phoneCountry) =>
        phoneCountry.iso.toUpperCase() === country.toUpperCase(),
    ) ?? null
  );
}

function getDefaultPhoneCountry() {
  const timeZone =
    typeof Intl === "undefined"
      ? ""
      : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const browserZone = timeZone.split("/")[1];

  return (
    phoneCountries.find((country) =>
      browserZone ? country.timezones.includes(browserZone) : false,
    ) ?? phoneCountries[0]
  );
}

function getCellsMaxLength(field: SigningField): number | undefined {
  if (field.type !== "cells") {
    return undefined;
  }

  const area = field.areas?.[0];

  if (!area?.cell_w || !area.w) {
    return undefined;
  }

  const cells = area.w / area.cell_w;

  return cells % 1 > 0.2 ? Math.trunc(cells) + 1 : Math.trunc(cells);
}

function getValidationPattern(field: SigningField): string | undefined {
  const pattern = field.validation?.pattern;

  return typeof pattern === "string" ? pattern : undefined;
}

function getValidationNumber(
  field: SigningField,
  key: "max" | "min" | "step",
): number | string | undefined {
  const value = field.validation?.[key];

  return typeof value === "number" || typeof value === "string"
    ? value
    : undefined;
}

function getDateInputType(
  field: SigningField,
): "date" | "datetime-local" | "month" {
  const format = field.preferences?.format;

  if (typeof format !== "string") {
    return "date";
  }

  if (/[HhAasz]/.test(format)) {
    return "datetime-local";
  }

  if (format && !/[Dd]/.test(format)) {
    return "month";
  }

  return "date";
}

function getDateInputValue(
  value: string,
  inputType: "date" | "datetime-local" | "month",
): string {
  if (!value || inputType !== "datetime-local") {
    return value;
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );

  return localDate.toISOString().slice(0, 16);
}

function getTodayInputValue(inputType: "date" | "datetime-local" | "month") {
  const date = new Date();
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );
  const localIso = localDate.toISOString();

  if (inputType === "month") {
    return localIso.slice(0, 7);
  }

  if (inputType === "datetime-local") {
    return localIso.slice(0, 16);
  }

  return localIso.slice(0, 10);
}

function getDateValidationValue(
  field: SigningField,
  key: "max" | "min",
  inputType: "date" | "datetime-local" | "month",
): string | undefined {
  const value = field.validation?.[key];

  if (typeof value !== "string") {
    return undefined;
  }

  if (value === "{{date}}" || value === "{date}") {
    return getTodayInputValue(inputType);
  }

  if (inputType === "datetime-local") {
    return getDateInputValue(value, inputType);
  }

  return value;
}

function canSetToday(
  field: SigningField,
  inputType: "date" | "datetime-local" | "month",
): boolean {
  if (inputType === "datetime-local") {
    return false;
  }

  const today = getTodayInputValue(inputType);
  const min = getDateValidationValue(field, "min", inputType);
  const max = getDateValidationValue(field, "max", inputType);

  return (!min || min <= today) && (!max || today <= max);
}

function getSigningReasonValue(form: SigningForm, field: SigningField): string {
  if (!field.uuid) {
    return "";
  }

  const value = form.values[getSigningReasonValueKey(field.uuid)];

  return typeof value === "string" ? value : "";
}

function getSigningReasonValueKey(fieldUuid: string): string {
  return `${fieldUuid}_reason`;
}
