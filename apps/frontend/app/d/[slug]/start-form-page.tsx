"use client";

import { SigningBrandStyle, signingNavigationUrl } from "@/components/branding/signing-brand-style";
import { BrandLogo } from "@/components/branding/brand-logo";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileWarningIcon, MailIcon, PenLineIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  getStartForm,
  sendStartFormEmailVerification,
  submitStartForm,
  type StartForm,
  type StartFormSubmitter,
  verifyStartFormEmail,
} from "@/lib/api/start-form";

type Step = "identity" | "verification";

export function StartFormPage({ slug }: { slug: string }) {
  const router = useRouter();
  const [form, setForm] = useState<StartForm | null>(null);
  const [submitter, setSubmitter] = useState<StartFormSubmitter>({});
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("identity");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    getStartForm(slug)
      .then(setForm)
      .catch((loadError: unknown) => {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "This shared form could not be opened.",
        );
      })
      .finally(() => setIsLoading(false));
  }, [slug]);

  const requiredFields = useMemo(
    () => form?.link_form_fields ?? ["email"],
    [form?.link_form_fields],
  );

  async function handleIdentitySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form) {
      return;
    }

    setIsSubmitting(true);

    try {
      if (form.require_email_2fa) {
        await sendStartFormEmailVerification(slug, {
          ...submitter,
          email: submitter.email ?? "",
        });
        setStep("verification");
        toast.success("Verification code sent");
        return;
      }

      const response = await submitStartForm(slug, submitter);

      router.push(signingNavigationUrl(response.signing_url));
    } catch (submitError) {
      toast.error("Unable to continue", {
        description:
          submitError instanceof Error
            ? submitError.message
            : "Please check the details and try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerificationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await verifyStartFormEmail(slug, {
        ...submitter,
        one_time_code: code,
      });

      router.push(signingNavigationUrl(response.signing_url));
    } catch (submitError) {
      toast.error("Verification failed", {
        description:
          submitError instanceof Error
            ? submitError.message
            : "Please check the code and try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resendCode() {
    if (!submitter.email) {
      return;
    }

    await sendStartFormEmailVerification(slug, {
      ...submitter,
      email: submitter.email,
    });
    toast.success("Verification code resent");
  }

  if (isLoading) {
    return <StartFormShell state={<Spinner />} title="Loading form" />;
  }

  if (error || !form) {
    return (
      <StartFormShell
        icon={<FileWarningIcon className="size-10" />}
        state={
          <p className="text-center text-sm text-[var(--auth-muted-foreground)]">
            {error ?? "This shared form could not be opened."}
          </p>
        }
        title="Form unavailable"
      />
    );
  }

  return (
    <StartFormShell
      branding={form.branding}
      icon={<PenLineIcon className="size-10" />}
      state={
        step === "identity" ? (
          <form className="space-y-4" onSubmit={handleIdentitySubmit}>
            {requiredFields.includes("name") ? (
              <StartFormInput
                autoComplete="name"
                onChange={(name) => setSubmitter((value) => ({ ...value, name }))}
                placeholder="Name"
                value={submitter.name ?? ""}
              />
            ) : null}
            {requiredFields.includes("email") ? (
              <StartFormInput
                autoComplete="email"
                onChange={(email) =>
                  setSubmitter((value) => ({ ...value, email }))
                }
                placeholder="Email"
                type="email"
                value={submitter.email ?? ""}
              />
            ) : null}
            {requiredFields.includes("phone") ? (
              <StartFormInput
                autoComplete="tel"
                onChange={(phone) =>
                  setSubmitter((value) => ({ ...value, phone }))
                }
                placeholder="Phone"
                type="tel"
                value={submitter.phone ?? ""}
              />
            ) : null}
            <Button
              className="h-12 w-full rounded-full bg-[var(--auth-primary)] text-sm font-bold text-white hover:bg-[var(--auth-primary-hover)]"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? <Spinner /> : null}
              Continue
            </Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={handleVerificationSubmit}>
            <p className="text-sm leading-6 text-[var(--auth-muted-foreground)]">
              We sent a one-time verification code to your email address.
              Please enter the code below to continue.
            </p>
            <Input
              className="h-12 rounded-full text-center text-lg font-semibold tracking-[0.3em]"
              inputMode="numeric"
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXX-XXX"
              required
              value={code}
            />
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--auth-muted-foreground)]">
                {submitter.email}
              </span>
              <button
                className="font-semibold underline"
                onClick={resendCode}
                type="button"
              >
                Re-send code
              </button>
            </div>
            <Button
              className="h-12 w-full rounded-full bg-[var(--auth-primary)] text-sm font-bold text-white hover:bg-[var(--auth-primary-hover)]"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? <Spinner /> : null}
              Submit
            </Button>
          </form>
        )
      }
      subtitle={`Invited by ${form.account_name}`}
      title={form.template_name}
    />
  );
}

function StartFormShell({
  branding,
  icon,
  state,
  subtitle,
  title,
}: {
  branding?: StartForm["branding"];
  icon?: React.ReactNode;
  state: React.ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <main
      className="min-h-svh bg-[var(--auth-background)] px-4 py-10 text-[var(--auth-foreground)]"
      id="main-content"
      tabIndex={-1}
    >
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <div className="flex justify-center">
          <SigningBrandStyle branding={branding} />
          <BrandLogo branding={branding ?? null} />
        </div>
        <section className="rounded-xl bg-[var(--auth-muted)] p-4">
          <div className="flex items-center gap-3">
            <div className="text-[var(--auth-primary)]">
              {icon ?? <MailIcon className="size-10" />}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold">{title}</h1>
              {subtitle ? (
                <p className="truncate text-sm text-[var(--auth-muted-foreground)]">
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
        </section>
        {state}
      </div>
    </main>
  );
}

function StartFormInput({
  autoComplete,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  autoComplete?: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  value: string;
}) {
  return (
    <Input
      autoComplete={autoComplete}
      className="h-12 rounded-full"
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      required
      type={type}
      value={value}
    />
  );
}
