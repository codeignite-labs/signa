"use client";

import { BrandLogo } from "@/components/branding/brand-logo";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTopLoader } from "nextjs-toploader";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  BookOpenIcon,
  BracesIcon,
  Globe2Icon,
  InfoIcon,
  LogInIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  login,
  getRegistrationStatus,
  getSocialAuthStateKey,
  register,
  saveAuthSession,
  startSocialAuth,
  type RegistrationStatus,
  type SocialAuthProvider,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/api/http";
import { authFormSchema, type AuthFormValues } from "@/lib/forms/auth-forms";
import { authDictionaries, type AuthMode } from "@/lib/i18n/auth-dictionaries";
import {
  getStoredLocale,
  isLocale,
  localeLabels,
  locales,
  persistLocale,
  toAccountLocale,
  type Locale,
} from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import {
  Controller,
  useForm,
  type Control,
  type UseFormRegisterReturn,
} from "react-hook-form";

type AuthShellProps = {
  mode: AuthMode;
};

export function AuthShell({ mode }: AuthShellProps) {
  const [locale, setLocale] = useState<Locale>(() => getStoredLocale());
  const dictionary = authDictionaries[locale];
  const copy = dictionary.modes[mode];
  const showSocial = mode === "login" || mode === "register";
  const loader = useTopLoader();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsOtp, setNeedsOtp] = useState(mode === "otp");
  const [registrationStatus, setRegistrationStatus] =
    useState<RegistrationStatus | null>(null);
  const canRegister = registrationStatus?.can_register ?? mode === "register";
  const form = useForm<AuthFormValues>({
    resolver: zodResolver(authFormSchema),
    defaultValues: getAuthFormDefaults(mode),
  });

  useEffect(() => {
    if (mode !== "login" && mode !== "register") {
      return;
    }

    let isActive = true;

    void getRegistrationStatus()
      .then((status) => {
        if (isActive) {
          setRegistrationStatus(status);
        }
      })
      .catch(() => {
        if (isActive) {
          setRegistrationStatus(null);
        }
      });

    return () => {
      isActive = false;
    };
  }, [mode]);

  function handleLocaleChange(nextLocale: Locale) {
    setLocale(nextLocale);
    persistLocale(nextLocale);
  }

  async function handleValidSubmit(values: AuthFormValues) {
    setIsSubmitting(true);
    loader.start();
    form.clearErrors("root");

    try {
      if (mode === "login") {
        if (needsOtp && values.otp?.length !== 6) {
          form.setError("otp", {
            message: "Enter your 6-digit code.",
          });
          return;
        }

        const session = await login({
          email: values.email ?? "",
          otp_attempt: needsOtp ? values.otp : undefined,
          password: values.password ?? "",
        });

        saveAuthSession(session);
        toast.success("Signed in", {
          description: "Welcome back to Signa.",
          classNames: { icon: "text-green-500" },
        });
        router.replace(getPostAuthRedirectPath());
        return;
      }

      if (mode === "register") {
        if (!canRegister) {
          form.setError("root", {
            message:
              registrationStatus?.reason ??
              "Registration is disabled for this installation.",
          });
          return;
        }

        const session = await register(createRegisterInput(values, locale));

        saveAuthSession(session);
        toast.success("Account created", {
          description: "Your workspace is ready.",
          classNames: { icon: "text-green-500" },
        });
        router.replace(getPostAuthRedirectPath());
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 450));
    } catch (error) {
      if (isOtpRequiredError(error) && mode === "login") {
        setNeedsOtp(true);
        form.setError("otp", {
          message: "Enter the 6-digit code from your authenticator app.",
        });
        toast.error("Two-factor authentication required", {
          description: "Enter the code from your authenticator app.",
          classNames: { icon: "text-destructive" },
        });
        return;
      }

      form.setError("root", {
        message: getAuthSubmitError(error, mode),
      });
      toast.error(getAuthFailureTitle(mode), {
        description: getAuthSubmitError(error, mode),
        classNames: { icon: "text-destructive" },
      });
    } finally {
      loader.done();
      setIsSubmitting(false);
    }
  }

  return (
    <main
      className="min-h-svh bg-[var(--auth-background)] text-[var(--auth-foreground)]"
      id="main-content"
      tabIndex={-1}
    >
      <AuthHeader
        canRegister={canRegister}
        dictionary={dictionary}
        mode={mode}
      />
      <section className="mx-auto flex w-full max-w-lg flex-col px-3 pb-16 pt-5 sm:px-2">
        <h1 className="mt-1 text-center text-4xl font-bold tracking-normal text-[var(--auth-foreground)]">
          {copy.title}
        </h1>
        {mode === "register" && !canRegister ? (
          <RegistrationClosedMessage reason={registrationStatus?.reason} />
        ) : null}
        <form
          method="post"
          className={cn(
            "mt-8 flex flex-col gap-5",
            mode === "register" && !canRegister ? "hidden" : "",
          )}
          onSubmit={form.handleSubmit(handleValidSubmit)}
        >
          <FieldGroup className="gap-4">
            {copy.fields.includes("name") ? (
              <AuthField
                id="name"
                label={dictionary.fields.name}
                autoComplete="name"
                error={form.formState.errors.name?.message}
                registration={form.register("name")}
              />
            ) : null}
            {copy.fields.includes("email") ? (
              <AuthField
                id="email"
                label={dictionary.fields.email}
                type="email"
                autoComplete="email"
                autoFocus
                error={form.formState.errors.email?.message}
                registration={form.register("email")}
              />
            ) : null}
            {copy.fields.includes("password") ? (
              <AuthField
                id="password"
                label={
                  mode === "reset-password"
                    ? dictionary.fields.newPassword
                    : dictionary.fields.password
                }
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                description={
                  mode === "reset-password"
                    ? dictionary.fields.passwordDescription
                    : undefined
                }
                error={form.formState.errors.password?.message}
                registration={form.register("password")}
              />
            ) : null}
            {copy.fields.includes("confirmPassword") ? (
              <AuthField
                id="password-confirmation"
                label={dictionary.fields.confirmNewPassword}
                type="password"
                autoComplete="new-password"
                error={form.formState.errors.confirmPassword?.message}
                registration={form.register("confirmPassword")}
              />
            ) : null}
            {copy.fields.includes("otp") || needsOtp ? (
              <OtpField
                control={form.control}
                label={dictionary.fields.otp}
                error={form.formState.errors.otp?.message}
              />
            ) : null}
          </FieldGroup>
          <Button
            className="h-12 rounded-full bg-[var(--auth-primary)] text-sm font-bold text-[var(--auth-primary-foreground)] transition-colors hover:bg-[var(--auth-primary-hover)]"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? dictionary.pending[mode] : copy.submit}
          </Button>
          <FieldError className="text-center">
            {form.formState.errors.root?.message}
          </FieldError>
        </form>
        {showSocial ? (
          <SocialButtons
            canRegister={canRegister}
            dictionary={dictionary}
            mode={mode}
          />
        ) : null}
        <AuthLinks
          canRegister={canRegister}
          dictionary={dictionary}
          mode={mode}
        />
        <LanguagePicker
          dictionary={dictionary}
          locale={locale}
          onLocaleChange={handleLocaleChange}
        />
      </section>
    </main>
  );
}

function getAuthFailureTitle(mode: AuthMode): string {
  if (mode === "login") {
    return "Sign in failed";
  }

  if (mode === "register") {
    return "Registration failed";
  }

  return "Request failed";
}

function AuthHeader({
  canRegister,
  dictionary,
  mode,
}: {
  canRegister: boolean;
  dictionary: (typeof authDictionaries)[Locale];
  mode: AuthMode;
}) {
  return (
    <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
      <AuthHeaderLogo dictionary={dictionary} />
      <AuthHeaderActions
        canRegister={canRegister}
        dictionary={dictionary}
        mode={mode}
      />
    </header>
  );
}

function AuthHeaderLogo({
  dictionary,
}: {
  dictionary: (typeof authDictionaries)[Locale];
}) {
  return (
    <Link
      href="/"
      className="flex items-center gap-3 rounded-full text-[var(--auth-primary)] outline-none focus-visible:ring-3 focus-visible:ring-[var(--auth-brand)]/30"
      aria-label={dictionary.brand}
    >
      <span className="relative block size-11">
        <BrandLogo branding={null} />
      </span>
      <span className="text-2xl font-bold tracking-normal">Signa</span>
    </Link>
  );
}

function AuthHeaderActions({
  canRegister,
  dictionary,
  mode,
}: {
  canRegister: boolean;
  dictionary: (typeof authDictionaries)[Locale];
  mode: AuthMode;
}) {
  if (mode === "login" && !canRegister) {
    return <AuthDocumentationLinks />;
  }

  return (
    <div className="flex items-center gap-2">
      {mode !== "login" ? (
        <AuthHeaderLoginButton dictionary={dictionary} />
      ) : null}
      {mode !== "register" && canRegister ? (
        <AuthHeaderRegisterButton dictionary={dictionary} />
      ) : null}
    </div>
  );
}

function AuthDocumentationLinks() {
  return (
    <nav className="flex items-center gap-2" aria-label="Documentation">
      <Button
        asChild
        className="h-11 rounded-full border-[var(--auth-primary)] bg-card px-5 font-bold text-[var(--auth-primary)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)]"
        variant="outline"
      >
        <Link href="/docs">
          <BookOpenIcon data-icon="inline-start" />
          Docs
        </Link>
      </Button>
      <Button
        asChild
        className="hidden h-11 rounded-full px-5 font-bold text-[var(--auth-primary)] hover:bg-[var(--auth-muted)] sm:inline-flex"
        variant="ghost"
      >
        <Link href="/docs/api">
          <BracesIcon data-icon="inline-start" />
          API
        </Link>
      </Button>
    </nav>
  );
}

function AuthHeaderLoginButton({
  dictionary,
}: {
  dictionary: (typeof authDictionaries)[Locale];
}) {
  return (
    <Button
      asChild
      className="h-11 rounded-full border-[var(--auth-primary)] bg-card px-5 font-bold text-[var(--auth-primary)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)]"
      variant="outline"
    >
      <Link href="/auth/login">
        <LogInIcon data-icon="inline-start" />
        {dictionary.header.signIn}
      </Link>
    </Button>
  );
}

function AuthHeaderRegisterButton({
  dictionary,
}: {
  dictionary: (typeof authDictionaries)[Locale];
}) {
  return (
    <Button
      asChild
      className="h-11 rounded-full bg-[var(--auth-primary)] px-5 font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
    >
      <Link href="/auth/register">{dictionary.header.createAccount}</Link>
    </Button>
  );
}

function RegistrationClosedMessage({ reason }: { reason?: string | null }) {
  return (
    <div className="mt-8 rounded-3xl border border-[var(--auth-border)] bg-card px-6 py-5 text-center shadow-sm">
      <p className="text-lg font-bold text-[var(--auth-foreground)]">
        Registration is closed
      </p>
      <p className="mt-2 text-sm leading-6 text-[var(--auth-muted-foreground)]">
        {reason ??
          "Ask an administrator to invite you to this Signa installation."}
      </p>
      <Button
        asChild
        className="mt-5 h-11 rounded-full bg-[var(--auth-primary)] px-6 font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
      >
        <Link href="/auth/login">Go to sign in</Link>
      </Button>
    </div>
  );
}

function AuthField({
  id,
  label,
  description,
  error,
  registration,
  className,
  ...props
}: React.ComponentProps<typeof Input> & {
  id: string;
  label: string;
  description?: string;
  error?: string;
  registration?: UseFormRegisterReturn;
}) {
  return (
    <Field className="gap-2" data-invalid={!!error}>
      <FieldLabel
        className="text-base font-medium text-[var(--auth-label)]"
        htmlFor={id}
      >
        {label}
      </FieldLabel>
      <Input
        aria-invalid={!!error}
        className={cn(
          "h-12 rounded-full border-[var(--auth-input-border)] bg-card px-5 text-base shadow-none focus-visible:border-[var(--auth-primary)] focus-visible:ring-[var(--auth-primary)]/20",
          className,
        )}
        id={id}
        {...registration}
        {...props}
      />
      <FieldError>{error}</FieldError>
      {description ? (
        <FieldDescription className="px-1 text-[var(--auth-label)]">
          {description}
        </FieldDescription>
      ) : null}
    </Field>
  );
}

function OtpField({
  control,
  error,
  label,
}: {
  control: Control<AuthFormValues>;
  error?: string;
  label: string;
}) {
  return (
    <Field className="items-center gap-3" data-invalid={!!error}>
      <FieldLabel
        className="text-base font-medium text-[var(--auth-label)]"
        htmlFor="otp"
      >
        {label}
      </FieldLabel>
      <Controller
        control={control}
        name="otp"
        render={({ field }) => (
          <InputOTP
            aria-invalid={!!error}
            autoFocus
            containerClassName="justify-center"
            id="otp"
            maxLength={6}
            pattern="[0-9]*"
            {...field}
          >
            <InputOTPGroup>
              <InputOTPSlot className="size-12 text-base" index={0} />
              <InputOTPSlot className="size-12 text-base" index={1} />
              <InputOTPSlot className="size-12 text-base" index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot className="size-12 text-base" index={3} />
              <InputOTPSlot className="size-12 text-base" index={4} />
              <InputOTPSlot className="size-12 text-base" index={5} />
            </InputOTPGroup>
          </InputOTP>
        )}
      />
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function SocialButtons({
  canRegister,
  dictionary,
  mode,
}: {
  canRegister: boolean;
  dictionary: (typeof authDictionaries)[Locale];
  mode: AuthMode;
}) {
  if (mode === "register" && !canRegister) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <AuthProviderButton
        dictionary={dictionary}
        mode={mode}
        provider="google"
      />
    </div>
  );
}

function AuthProviderButton({
  dictionary,
  mode,
  provider,
}: {
  dictionary: (typeof authDictionaries)[Locale];
  mode: AuthMode;
  provider: SocialAuthProvider;
}) {

  const [pending, setPending] = useState(false);

  async function handleProviderClick() {
    if (pending) return;
    setPending(true);
    try {
      const response = await startSocialAuth(provider, {
        mode: mode === "register" ? "register" : "login",
      });

      window.sessionStorage.setItem(
        getSocialAuthStateKey(provider),
        response.state,
      );
      window.location.assign(response.url);
    } catch (error) {
      toast.error("Google sign-in could not start", {
        description:
          error instanceof ApiError
            ? error.message
            : "Add the OAuth client id, client secret, and redirect URI environment variables.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      className="h-12 rounded-full border-2 border-[var(--auth-primary)] bg-card text-sm font-bold text-[var(--auth-foreground)] transition-colors hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)]"
      aria-busy={pending}
      disabled={pending}
      onClick={() => void handleProviderClick()}
      type="button"
      variant="outline"
    >
      <GoogleMark />
      {dictionary.social.google}
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

function AuthLinks({
  canRegister,
  dictionary,
  mode,
}: {
  canRegister: boolean;
  dictionary: (typeof authDictionaries)[Locale];
  mode: AuthMode;
}) {
  if (mode === "forgot-password" || mode === "reset-password") {
    return (
      <div className="mt-5 flex justify-center">
        <Link className="auth-link" href="/auth/login">
          {dictionary.links.alreadyHaveAccount}
        </Link>
      </div>
    );
  }

  if (mode === "otp") {
    return (
      <div className="mt-5 flex justify-center">
        <Link className="auth-link" href="/auth/login">
          {dictionary.links.backToSignIn}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-5 flex justify-between gap-4 text-base font-medium">
      {mode === "register" || canRegister ? (
        <Link
          className="auth-link"
          href={mode === "register" ? "/auth/login" : "/auth/register"}
        >
          {mode === "register"
            ? dictionary.links.alreadyHaveAccount
            : dictionary.links.createAccount}
        </Link>
      ) : (
        <span />
      )}
      <Link className="auth-link" href="/auth/forgot-password">
        {dictionary.links.forgotPassword}
      </Link>
    </div>
  );
}

function LanguagePicker({
  dictionary,
  locale,
  onLocaleChange,
}: {
  dictionary: (typeof authDictionaries)[Locale];
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  return (
    <>
      <FieldSeparator className="sr-only">{dictionary.language}</FieldSeparator>
      <div className="mt-10 flex justify-center">
        <Select
          onValueChange={(value) => {
            if (isLocale(value)) {
              onLocaleChange(value);
            }
          }}
          value={locale}
        >
          <SelectTrigger
            aria-label={dictionary.language}
            className="h-9 rounded-full border-transparent bg-transparent px-2 text-base font-semibold text-[var(--auth-foreground)] shadow-none hover:bg-[var(--auth-muted)] focus-visible:border-transparent focus-visible:ring-[var(--auth-primary)]/20"
            size="sm"
          >
            <Globe2Icon data-icon="inline-start" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {locales.map((item) => (
                <SelectItem key={item} value={item}>
                  {localeLabels[item]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

export function AuthNotice({ message }: { message: string }) {
  return (
    <div className="mx-auto mt-0 flex h-12 w-full max-w-xl items-center justify-between rounded-2xl bg-[var(--auth-muted)] px-5 text-sm font-medium text-[var(--auth-label)]">
      <span className="flex items-center gap-3">
        <InfoIcon data-icon="inline-start" />
        {message}
      </span>
      <span aria-hidden="true">×</span>
    </div>
  );
}

function getPostAuthRedirectPath(): string {
  if (typeof window === "undefined") {
    return "/templates";
  }

  const nextPath = new URLSearchParams(window.location.search).get("next");

  if (!nextPath?.startsWith("/") || nextPath.startsWith("//")) {
    return "/templates";
  }

  if (nextPath.startsWith("/auth")) {
    return "/templates";
  }

  return nextPath;
}

function getAuthFormDefaults(mode: AuthMode): AuthFormValues {
  return {
    mode,
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    otp: "",
  };
}

function createRegisterInput(
  values: AuthFormValues,
  locale: Locale,
): Parameters<typeof register>[0] {
  const nameParts = (values.name ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? "Signa";
  const lastName = nameParts.slice(1).join(" ");
  const timezone =
    typeof Intl === "undefined"
      ? "UTC"
      : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  return {
    account_name: `${firstName}'s Account`,
    email: values.email ?? "",
    first_name: firstName,
    last_name: lastName,
    locale: toAccountLocale(locale),
    password: values.password ?? "",
    timezone,
  };
}

function getAuthSubmitError(error: unknown, mode: AuthMode): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (mode === "register") {
    return "Unable to create your account. Please try again.";
  }

  return "Unable to sign in. Please try again.";
}

function isOtpRequiredError(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }

  if (error.message.toLowerCase().includes("two-factor")) {
    return error.message.toLowerCase().includes("required");
  }

  const details = error.details;

  if (!details || typeof details !== "object") {
    return false;
  }

  return "code" in details && details.code === "otp_required";
}
