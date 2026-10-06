"use client";

import type React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  CloudUploadIcon,
  Trash2Icon,
} from "lucide-react";
import type SignatureCanvasType from "react-signature-canvas";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api/http";
import {
  deleteProfileAsset,
  getAuthSession,
  getMfaStatus,
  getProfile,
  getProfileAsset,
  type AuthUser,
  type ProfileAsset,
  type UpdateProfileInput,
  updatePassword,
  updateProfile,
  uploadProfileAsset,
} from "@/lib/api/auth";
import { cn } from "@/lib/utils";
import { getChangedFields } from "@/lib/object-diff";
import { MfaSection } from "./profile-mfa-section";
import { SettingsSidebar } from "./settings-sidebar";

type SignatureCanvasProps = {
  canvasProps?: React.CanvasHTMLAttributes<HTMLCanvasElement>;
  penColor?: string;
  ref?: React.Ref<SignatureCanvasType>;
};

const SignatureCanvas = dynamic(() => import("react-signature-canvas"), {
  ssr: false,
}) as React.ComponentType<SignatureCanvasProps>;


type ProfileFormState = {
  firstName: string;
  lastName: string;
  email: string;
};

type ProfileAssetKey = "signature" | "initials";

type PasswordFormState = {
  password: string;
  passwordConfirmation: string;
  currentPassword: string;
};

export function ProfileSettingsBody() {
  return (
    <div className="flex flex-wrap gap-8 md:flex-nowrap">
      <SettingsSidebar active="Profile" />
      <ProfilePanel />
      <div className="hidden w-52 shrink-0 md:block" />
    </div>
  );
}

function ProfilePanel() {
  const router = useRouter();
  const [form, setForm] = useState<ProfileFormState>(() =>
    getFormState(getInitialUser()),
  );
  const [initialForm, setInitialForm] = useState<ProfileFormState>(() =>
    getFormState(getInitialUser()),
  );
  const [assets, setAssets] = useState<
    Record<ProfileAssetKey, ProfileAsset | null>
  >({
    initials: null,
    signature: null,
  });
  const [assetDialog, setAssetDialog] = useState<ProfileAssetKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMfaEnabled, setIsMfaEnabled] = useState(false);

  useEffect(() => {
    Promise.all([
      getProfile(),
      getProfileAsset("signature"),
      getProfileAsset("initials"),
      getMfaStatus(),
    ])
      .then(([user, signature, initials, mfa]) => {
        const nextForm = getFormState(user);

        setForm(nextForm);
        setInitialForm(nextForm);
        setAssets({ initials, signature });
        setIsMfaEnabled(mfa.otp_required_for_login);
      })
      .catch((profileError: unknown) => {
        if (profileError instanceof ApiError && profileError.status === 401) {
          router.push("/auth/login");
          return;
        }

        setError(getErrorMessage(profileError));
        toast.error("Profile could not be loaded", {
          description: getErrorMessage(profileError),
          classNames: { icon: "text-destructive" },
        });
      });
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const patch = getProfilePatch(form, initialForm);

    if (Object.keys(patch).length === 0) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const user = await updateProfile(patch);
      const nextForm = getFormState(user);

      setForm(nextForm);
      setInitialForm(nextForm);
      toast.success("Profile updated", {
        description: "Your profile details have been saved.",
        classNames: { icon: "text-green-500" },
      });
    } catch (submitError) {
      const message = getErrorMessage(submitError);

      setError(message);
      toast.error("Profile update failed", {
        description: message,
        classNames: { icon: "text-destructive" },
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveAsset(key: ProfileAssetKey, file: File) {
    const asset = await uploadProfileAsset(key, file);
    setAssets((current) => ({ ...current, [key]: asset }));
  }

  async function removeAsset(key: ProfileAssetKey) {
    await deleteProfileAsset(key);
    setAssets((current) => ({ ...current, [key]: null }));
    toast.success(`${assetLabel(key)} removed`);
  }

  const profilePatch = getProfilePatch(form, initialForm);
  const hasProfileChanges = Object.keys(profilePatch).length > 0;

  return (
    <section className="mx-auto w-full max-w-xl flex-1">
      <h1 className="mb-6 text-4xl font-bold tracking-normal">Profile</h1>
      <form
        autoComplete="off"
        className="flex flex-col gap-4"
        onSubmit={handleSubmit}
      >
        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-2">
            <ProfileInput
              id="first-name"
              label="First name"
              onChange={(value) =>
                setForm((current) => ({ ...current, firstName: value }))
              }
              required
              value={form.firstName}
            />
            <ProfileInput
              id="last-name"
              label="Last name"
              onChange={(value) =>
                setForm((current) => ({ ...current, lastName: value }))
              }
              value={form.lastName}
            />
          </div>
          <ProfileInput
            id="email"
            label="Email"
            onChange={(value) =>
              setForm((current) => ({ ...current, email: value }))
            }
            required
            type="email"
            value={form.email}
          />
          <PrimaryButton
            disabled={isSubmitting || !hasProfileChanges}
            type="submit"
          >
            {isSubmitting ? "UPDATING" : "UPDATE"}
          </PrimaryButton>
          {error ? <FieldError>{error}</FieldError> : null}
        </FieldGroup>
      </form>

      <ProfileSection
        description="Send signature request to your recipients directly from your email"
        title="Email Integration"
      >
        <IntegrationButton />
      </ProfileSection>

      <AssetSection
        asset={assets.signature}
        label="Signature"
        onRemove={() => removeAsset("signature")}
        onUpdate={() => setAssetDialog("signature")}
      />
      <AssetSection
        asset={assets.initials}
        label="Initials"
        onRemove={() => removeAsset("initials")}
        onUpdate={() => setAssetDialog("initials")}
      />

      <PasswordSection />
      <MfaSection enabled={isMfaEnabled} onChange={setIsMfaEnabled} />

      <ProfileAssetDialog
        assetKey={assetDialog}
        onOpenChange={(open) => {
          if (!open) {
            setAssetDialog(null);
          }
        }}
        onSave={saveAsset}
      />
    </section>
  );
}

function ProfileInput({
  id,
  label,
  onChange,
  required,
  type = "text",
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  value: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        className="h-12 rounded-full border-[var(--auth-input-border)] bg-card px-5"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        value={value}
      />
    </Field>
  );
}

function AssetSection({
  asset,
  label,
  onRemove,
  onUpdate,
}: {
  asset: ProfileAsset | null;
  label: string;
  onRemove: () => Promise<void>;
  onUpdate: () => void;
}) {
  const [isRemoving, setIsRemoving] = useState(false);

  async function handleRemove() {
    setIsRemoving(true);
    try {
      await onRemove();
    } catch (error) {
      toast.error(`${label} removal failed`, {
        description: getErrorMessage(error),
        classNames: { icon: "text-destructive" },
      });
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <ProfileSection title={label}>
      {asset ? (
        <div className="relative flex min-h-36 items-center justify-center rounded-3xl bg-[var(--auth-muted)] p-4">
          <button
            className="absolute right-4 top-4 flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold text-[var(--auth-foreground)] hover:bg-card"
            disabled={isRemoving}
            onClick={handleRemove}
            type="button"
          >
            <Trash2Icon className="size-4" />
            {isRemoving ? "REMOVING" : "REMOVE"}
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- Uploaded profile assets use signed dynamic URLs that are better rendered directly. */}
          <img
            alt={label}
            className="max-h-32 w-full object-contain"
            src={asset.url}
          />
        </div>
      ) : null}
      <PrimaryButton onClick={onUpdate} type="button">
        UPDATE {label.toUpperCase()}
      </PrimaryButton>
    </ProfileSection>
  );
}

function ProfileAssetDialog({
  assetKey,
  onOpenChange,
  onSave,
}: {
  assetKey: ProfileAssetKey | null;
  onOpenChange: (open: boolean) => void;
  onSave: (key: ProfileAssetKey, file: File) => Promise<void>;
}) {
  const signaturePadRef = useRef<SignatureCanvasType | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [tab, setTab] = useState("draw");
  const open = assetKey !== null;

  async function handleSave() {
    if (!assetKey) {
      return;
    }

    setIsSaving(true);
    try {
      const file =
        tab === "draw"
          ? getDrawnAssetFile(signaturePadRef.current, assetKey)
          : uploadFile;

      if (!file) {
        throw new Error(`Add a ${assetLabel(assetKey).toLowerCase()} first`);
      }

      await onSave(assetKey, file);
      toast.success(`${assetLabel(assetKey)} saved`);
      onOpenChange(false);
      setUploadFile(null);
    } catch (error) {
      toast.error(`${assetLabel(assetKey ?? "signature")} save failed`, {
        description: getErrorMessage(error),
        classNames: { icon: "text-destructive" },
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 bg-[var(--auth-background)] p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-[var(--auth-border)] px-6 py-5">
          <DialogTitle className="text-base font-bold">
            Update {assetLabel(assetKey ?? "signature")}
          </DialogTitle>
        </DialogHeader>
        <div className="px-6 py-4">
          <Tabs onValueChange={setTab} value={tab}>
            <TabsList className="mx-auto grid h-8 w-56 grid-cols-2 rounded-full bg-[var(--auth-muted)] p-0">
              <TabsTrigger className="rounded-full font-bold" value="draw">
                Draw
              </TabsTrigger>
              <TabsTrigger className="rounded-full font-bold" value="upload">
                Upload
              </TabsTrigger>
            </TabsList>
            <TabsContent className="mt-3" value="draw">
              <div className="relative rounded border border-[var(--auth-border)] bg-white">
                <button
                  className="absolute right-2 top-1 text-sm underline"
                  onClick={() => signaturePadRef.current?.clear()}
                  type="button"
                >
                  Clear
                </button>
                <SignatureCanvas
                  canvasProps={{
                    className: "h-48 w-full",
                  }}
                  penColor="#1f1230"
                  ref={signaturePadRef}
                />
              </div>
            </TabsContent>
            <TabsContent className="mt-3" value="upload">
              <label className="flex h-48 cursor-pointer flex-col items-center justify-center rounded border border-dashed border-[var(--auth-primary)] bg-card text-center hover:bg-[var(--auth-muted)]">
                <CloudUploadIcon className="mb-2 size-9" />
                <span className="font-bold">
                  {uploadFile?.name ??
                    `Upload ${assetLabel(assetKey ?? "signature")}`}
                </span>
                <span className="text-xs text-[var(--auth-label)]">
                  PNG or JPEG
                </span>
                <input
                  accept="image/png,image/jpeg,image/jpg"
                  className="hidden"
                  onChange={(event) =>
                    setUploadFile(event.target.files?.[0] ?? null)
                  }
                  type="file"
                />
              </label>
            </TabsContent>
          </Tabs>
          <PrimaryButton
            className="mt-4"
            disabled={isSaving}
            onClick={handleSave}
            type="button"
          >
            {isSaving ? "SAVING" : "SAVE"}
          </PrimaryButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PasswordSection() {
  const [form, setForm] = useState<PasswordFormState>({
    currentPassword: "",
    password: "",
    passwordConfirmation: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasPasswordChanges = Object.values(form).some((value) => value);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!hasPasswordChanges) {
      return;
    }

    setIsSubmitting(true);
    try {
      await updatePassword({
        current_password: form.currentPassword,
        password: form.password,
        password_confirmation: form.passwordConfirmation,
      });
      setForm({
        currentPassword: "",
        password: "",
        passwordConfirmation: "",
      });
      toast.success("Password updated");
    } catch (error) {
      toast.error("Password update failed", {
        description: getErrorMessage(error),
        classNames: { icon: "text-destructive" },
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ProfileSection title="Change Password">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <PasswordInput
          id="new-password"
          label="New password"
          onChange={(value) =>
            setForm((current) => ({ ...current, password: value }))
          }
          value={form.password}
        />
        <PasswordInput
          id="password-confirmation"
          label="Confirm password"
          onChange={(value) =>
            setForm((current) => ({ ...current, passwordConfirmation: value }))
          }
          value={form.passwordConfirmation}
        />
        <PasswordInput
          id="current-password"
          label="Current password"
          onChange={(value) =>
            setForm((current) => ({ ...current, currentPassword: value }))
          }
          value={form.currentPassword}
        />
        <PrimaryButton disabled={isSubmitting || !hasPasswordChanges} type="submit">
          {isSubmitting ? "UPDATING" : "UPDATE"}
        </PrimaryButton>
      </form>
    </ProfileSection>
  );
}

function PasswordInput({
  id,
  label,
  onChange,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        autoComplete={
          id === "current-password" ? "current-password" : "new-password"
        }
        className="h-12 rounded-full border-[var(--auth-input-border)] bg-card px-5"
        id={id}
        minLength={8}
        onChange={(event) => onChange(event.target.value)}
        required
        type="password"
        value={value}
      />
    </Field>
  );
}

function ProfileSection({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="mt-8 flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-bold tracking-normal">{title}</h2>
        {description ? <p className="mt-2">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function PrimaryButton({
  buttonStyle = "primary",
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  buttonStyle?: "primary" | "outline";
}) {
  return (
    <Button
      className={cn(
        "h-12 w-full rounded-full font-bold",
        buttonStyle === "primary"
          ? "bg-[var(--auth-primary)] text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
          : "border-2 border-[var(--auth-primary)] bg-card text-[var(--auth-foreground)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)]",
        className,
      )}
      variant={buttonStyle === "outline" ? "outline" : "default"}
      {...props}
    >
      {children}
    </Button>
  );
}

function IntegrationButton() {
  return (
    <Button
      className="h-12 w-full rounded-full border-2 border-[var(--auth-primary)] bg-card font-bold text-[var(--auth-foreground)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)]"
      asChild
      variant="outline"
    >
      <Link href="/settings/integrations"><GoogleMark />CONNECT GMAIL</Link>
    </Button>
  );
}

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      className="size-5"
      fill="none"
      viewBox="-0.5 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M9.82727273,24 C9.82727273,22.4757333 10.0804318,21.0144 10.5322727,19.6437333 L2.62345455,13.6042667 C1.08206818,16.7338667 0.213636364,20.2602667 0.213636364,24 C0.213636364,27.7365333 1.081,31.2608 2.62025,34.3882667 L10.5247955,28.3370667 C10.0772273,26.9728 9.82727273,25.5168 9.82727273,24"
        fill="#FBBC05"
      />
      <path
        d="M23.7136364,10.1333333 C27.025,10.1333333 30.0159091,11.3066667 32.3659091,13.2266667 L39.2022727,6.4 C35.0363636,2.77333333 29.6954545,0.533333333 23.7136364,0.533333333 C14.4268636,0.533333333 6.44540909,5.84426667 2.62345455,13.6042667 L10.5322727,19.6437333 C12.3545909,14.112 17.5491591,10.1333333 23.7136364,10.1333333"
        fill="#EB4335"
      />
      <path
        d="M23.7136364,37.8666667 C17.5491591,37.8666667 12.3545909,33.888 10.5322727,28.3562667 L2.62345455,34.3946667 C6.44540909,42.1557333 14.4268636,47.4666667 23.7136364,47.4666667 C29.4455,47.4666667 34.9177955,45.4314667 39.0249545,41.6181333 L31.5177727,35.8144 C29.3995682,37.1488 26.7323182,37.8666667 23.7136364,37.8666667"
        fill="#34A853"
      />
      <path
        d="M46.1454545,24 C46.1454545,22.6133333 45.9318182,21.12 45.6113636,19.7333333 L23.7136364,19.7333333 L23.7136364,28.8 L36.3181818,28.8 C35.6879545,31.8912 33.9724545,34.2677333 31.5177727,35.8144 L39.0249545,41.6181333 C43.3393409,37.6138667 46.1454545,31.6490667 46.1454545,24"
        fill="#4285F4"
      />
    </svg>
  );
}

function getDrawnAssetFile(
  pad: SignatureCanvasType | null,
  key: ProfileAssetKey,
): File | null {
  if (!pad || pad.isEmpty()) {
    return null;
  }

  const dataUrl = pad.getTrimmedCanvas().toDataURL("image/png");

  return dataUrlToFile(dataUrl, `${key}.png`);
}

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [metadata, base64] = dataUrl.split(",");
  const mimeMatch = metadata.match(/data:(.*);base64/);
  const mime = mimeMatch?.[1] ?? "image/png";
  const bytes = window.atob(base64);
  const buffer = new Uint8Array(bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    buffer[index] = bytes.charCodeAt(index);
  }

  return new File([buffer], filename, { type: mime });
}

function assetLabel(key: ProfileAssetKey): string {
  return key === "signature" ? "Signature" : "Initials";
}

function getInitialUser(): AuthUser {
  const session = getAuthSession();

  return (
    session?.user ?? {
      email: "",
      first_name: "",
      id: "",
      last_name: "",
      role: "member",
    }
  );
}

function getFormState(user: AuthUser): ProfileFormState {
  return {
    email: user.email,
    firstName: user.first_name ?? "",
    lastName: user.last_name ?? "",
  };
}

function getProfilePatch(
  form: ProfileFormState,
  initialForm: ProfileFormState,
): UpdateProfileInput {
  const changes = getChangedFields(form, initialForm);
  const patch: UpdateProfileInput = {};

  if (changes.email !== undefined) {
    patch.email = changes.email;
  }

  if (changes.firstName !== undefined) {
    patch.first_name = changes.firstName;
  }

  if (changes.lastName !== undefined) {
    patch.last_name = changes.lastName;
  }

  return patch;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong";
}
