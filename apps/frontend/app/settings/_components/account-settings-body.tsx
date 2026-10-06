"use client";

import type React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AccountBranding } from "@repo/shared/branding";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CircleAlertIcon, HelpCircleIcon } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/http";
import {
  type AccountPreferences,
  deleteAccount,
  getAccount,
  getAccountPreferences,
  getAuthSession,
  updateAccount,
  updateAccountPreferences,
  type AuthAccount,
  type UpdateAccountInput,
} from "@/lib/api/auth";
import type { AppDictionary } from "@/lib/i18n/app-dictionaries";
import {
  localeLabels,
  locales,
  normalizeLocale,
  toAccountLocale,
} from "@/lib/i18n/config";
import { useAppI18n } from "@/lib/i18n/use-app-i18n";
import { getChangedFields } from "@/lib/object-diff";
import { SettingsSidebar } from "./settings-sidebar";

type AccountFormState = {
  locale: string;
  name: string;
  timezone: string;
};

type PreferenceItem = {
  description?: string;
  key: BooleanAccountPreferenceKey;
  label: string;
  mark?: string;
  tooltip: string;
};

type BooleanAccountPreferenceKey = {
  [Key in keyof AccountPreferences]: AccountPreferences[Key] extends boolean
    ? Key
    : never;
}[keyof AccountPreferences];

const timezones = [
  { label: "(GMT+03:00) Nairobi", value: "Africa/Nairobi" },
  { label: "(GMT+00:00) UTC", value: "UTC" },
  { label: "(GMT+00:00) London", value: "Europe/London" },
  { label: "(GMT+01:00) Paris", value: "Europe/Paris" },
  { label: "(GMT-05:00) New York", value: "America/New_York" },
];

const preferenceKeys: BooleanAccountPreferenceKey[] = [
  "force_mfa",
  "with_signature_id",
  "require_signing_reason",
  "allow_typed_signature",
  "allow_to_resubmit",
  "allow_to_decline",
  "allow_to_delegate",
  "form_prefill_signature",
  "download_links_expire",
  "download_links_auth",
  "combine_pdf_result_key",
];

const complianceMarks: Partial<Record<BooleanAccountPreferenceKey, string>> = {
  cfr_part_11: "FDA",
  hipaa: "HIPAA",
  knowledge_based_authentication: "KBA",
};

export function AccountSettingsBody() {
  return (
    <div className="flex flex-wrap gap-8 md:flex-nowrap">
      <SettingsSidebar active="Account" />
      <AccountPanel />
      <div className="hidden w-52 shrink-0 md:block" />
    </div>
  );
}

function AccountPanel() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { dictionary, setLocale } = useAppI18n();
  const [form, setForm] = useState<AccountFormState>(() =>
    getFormState(getInitialAccount()),
  );
  const [initialForm, setInitialForm] = useState<AccountFormState>(() =>
    getFormState(getInitialAccount()),
  );
  const [preferences, setPreferences] = useState<AccountPreferences | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savingPreference, setSavingPreference] = useState<
    keyof AccountPreferences | null
  >(null);
  const [isSavingLocale, setIsSavingLocale] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const languageOptions = useMemo(
    () =>
      locales.map((locale) => ({
        label: localeLabels[locale],
        value: toAccountLocale(locale),
      })),
    [],
  );
  const preferenceItems = useMemo(
    () => buildPreferenceItems(dictionary),
    [dictionary],
  );
  const complianceItems = useMemo(
    () => buildComplianceItems(dictionary),
    [dictionary],
  );

  const languageLabel = useMemo(
    () =>
      languageOptions.find((language) => language.value === form.locale)
        ?.label ?? localeLabels.en,
    [form.locale, languageOptions],
  );

  useEffect(() => {
    Promise.all([getAccount(), getAccountPreferences()])
      .then(([account, accountPreferences]) => {
        const nextForm = getFormState(account);

        setForm(nextForm);
        setInitialForm(nextForm);
        setPreferences(accountPreferences);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof ApiError && loadError.status === 401) {
          router.push("/auth/login");
          return;
        }

        setError(getErrorMessage(loadError));
        toast.error(dictionary.account.loadedError, {
          description: getErrorMessage(loadError),
          classNames: { icon: "text-destructive" },
        });
      });
  }, [dictionary.account.loadedError, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const patch = getAccountPatch(form, initialForm);

    if (Object.keys(patch).length === 0) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const account = await updateAccount(patch);
      const brandingKey = ["account-branding", account.id];
      queryClient.setQueryData<AccountBranding>(brandingKey, (current) =>
        current ? { ...current, account_name: account.name } : current,
      );
      void queryClient.invalidateQueries({ queryKey: brandingKey });
      const nextForm = getFormState(account);

      setForm(nextForm);
      setInitialForm(nextForm);
      setLocale(normalizeLocale(account.locale));
      toast.success(dictionary.account.updated, {
        description: dictionary.account.savedDescription,
        classNames: { icon: "text-green-500" },
      });
    } catch (submitError) {
      const message = getErrorMessage(submitError);

      setError(message);
      toast.error(dictionary.account.updateFailed, {
        description: message,
        classNames: { icon: "text-destructive" },
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLocaleChange(locale: string) {
    const previousLocale = form.locale;

    if (locale === previousLocale) {
      return;
    }

    setForm((current) => ({ ...current, locale }));
    setLocale(normalizeLocale(locale));
    setIsSavingLocale(true);
    setError(null);

    try {
      const account = await updateAccount({ locale });

      setForm((current) => ({
        ...current,
        locale: account.locale,
      }));
      setInitialForm((current) => ({
        ...current,
        locale: account.locale,
      }));
      setLocale(normalizeLocale(account.locale));
    } catch (localeError) {
      const message = getErrorMessage(localeError);

      setForm((current) => ({ ...current, locale: previousLocale }));
      setLocale(normalizeLocale(previousLocale));
      setError(message);
      toast.error(dictionary.account.updateFailed, {
        description: message,
        classNames: { icon: "text-destructive" },
      });
    } finally {
      setIsSavingLocale(false);
    }
  }

  async function handlePreferenceChange(
    key: keyof AccountPreferences,
    value: boolean,
  ) {
    if (!preferences) {
      return;
    }

    if (preferences[key] === value) {
      return;
    }

    const nextPreferences = {
      ...preferences,
      [key]: value,
    };

    setPreferences(nextPreferences);
    setSavingPreference(key);
    setError(null);

    try {
      setPreferences(await updateAccountPreferences({ [key]: value }));
      toast.success(dictionary.account.preferenceUpdated, {
        description: getPreferenceLabel(key, preferenceItems, complianceItems),
        classNames: { icon: "text-green-500" },
      });
    } catch (preferenceError) {
      const message = getErrorMessage(preferenceError);

      setPreferences(preferences);
      setError(message);
      toast.error(dictionary.account.preferenceFailed, {
        description: message,
        classNames: { icon: "text-destructive" },
      });
    } finally {
      setSavingPreference(null);
    }
  }

  async function handleDeleteAccount() {
    setIsDeleting(true);
    setError(null);

    try {
      await deleteAccount();
      toast.success(dictionary.account.deleteTitle, {
        description: dictionary.common.signOut,
        classNames: { icon: "text-green-500" },
      });
      router.push("/auth/register");
    } catch (deleteError) {
      const message = getErrorMessage(deleteError);

      setError(message);
      toast.error(dictionary.account.updateFailed, {
        description: message,
        classNames: { icon: "text-destructive" },
      });
    } finally {
      setIsDeleting(false);
    }
  }

  const accountPatch = getAccountPatch(form, initialForm);
  const hasAccountChanges = Object.keys(accountPatch).length > 0;

  return (
    <TooltipProvider>
      <section className="mx-auto w-full max-w-[36rem] flex-1">
        <h1 className="mb-6 text-4xl font-bold tracking-normal">
          {dictionary.account.title}
        </h1>
        <form
          autoComplete="off"
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="company-name">
                {dictionary.account.companyName}
              </FieldLabel>
              <Input
                className="h-12 rounded-full border-[var(--auth-input-border)] bg-card px-5"
                id="company-name"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
                value={form.name}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
              <Field>
                <FieldLabel>{dictionary.account.timeZone}</FieldLabel>
                <Select
                  onValueChange={(timezone) =>
                    setForm((current) => ({ ...current, timezone }))
                  }
                  value={form.timezone}
                >
                  <SelectTrigger className="!h-12 w-full rounded-full border-[var(--auth-input-border)] bg-card px-5">
                    <SelectValue placeholder="Select time zone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {timezones.map((timezone) => (
                        <SelectItem key={timezone.value} value={timezone.value}>
                          {timezone.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>{dictionary.account.language}</FieldLabel>
                <Select
                  disabled={isSavingLocale}
                  onValueChange={handleLocaleChange}
                  value={form.locale}
                >
                  <SelectTrigger className="!h-12 w-full rounded-full border-[var(--auth-input-border)] bg-card px-5">
                    <SelectValue placeholder={languageLabel} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {languageOptions.map((language) => (
                        <SelectItem key={language.value} value={language.value}>
                          {language.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Button
              className="h-12 rounded-full bg-[var(--auth-primary)] font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
              disabled={isSubmitting || !hasAccountChanges}
              type="submit"
            >
              {isSubmitting
                ? dictionary.common.updating
                : dictionary.common.update}
            </Button>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>

        <AccountSection title={dictionary.account.preferences}>
          <div className="flex flex-col gap-4">
            {preferenceItems.map((item) => (
              <PreferenceRow
                checked={preferences?.[item.key] ?? false}
                disabled={savingPreference === item.key}
                item={item}
                key={item.key}
                onCheckedChange={(checked) =>
                  handlePreferenceChange(item.key, checked)
                }
              />
            ))}
          </div>
        </AccountSection>

        <AccountSection title={dictionary.account.compliance}>
          <div className="flex flex-col gap-4">
            {complianceItems.map((item) => (
              <ComplianceCard
                checked={preferences?.[item.key] ?? false}
                disabled={savingPreference === item.key}
                item={item}
                key={item.key}
                learnMoreLabel={dictionary.common.learnMore}
                onCheckedChange={(checked) =>
                  handlePreferenceChange(item.key, checked)
                }
              />
            ))}
          </div>
        </AccountSection>

        <DangerZone
          dictionary={dictionary}
          disabled={isDeleting}
          onDeleteAccount={handleDeleteAccount}
        />
      </section>
    </TooltipProvider>
  );
}

function AccountSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="mt-8 flex flex-col gap-4">
      <h2 className="text-2xl font-bold tracking-normal">{title}</h2>
      {children}
    </section>
  );
}

function PreferenceRow({
  checked,
  disabled,
  item,
  onCheckedChange,
}: {
  checked: boolean;
  disabled: boolean;
  item: PreferenceItem;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-4">
      <label
        className="flex items-center gap-1.5 text-base"
        htmlFor={`account-preference-${item.key}`}
      >
        {item.label}
        <Tooltip>
          <TooltipTrigger
            aria-label={`${item.label} help`}
            className="inline-flex text-[var(--auth-label)] transition-colors hover:text-[var(--auth-primary)]"
            type="button"
          >
            <HelpCircleIcon aria-hidden="true" className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="right">{item.tooltip}</TooltipContent>
        </Tooltip>
      </label>
      <Switch
        checked={checked}
        disabled={disabled}
        id={`account-preference-${item.key}`}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function ComplianceCard({
  checked,
  disabled,
  item,
  learnMoreLabel,
  onCheckedChange,
}: {
  checked: boolean;
  disabled: boolean;
  item: PreferenceItem;
  learnMoreLabel: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <article className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--auth-input-border)] bg-card p-4">
      <div className="flex items-center gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-[var(--auth-input-border)] bg-[var(--auth-muted)] px-2 text-center text-sm font-extrabold leading-none text-[var(--auth-primary)]">
          {item.mark}
        </div>
        <div>
          <h3 className="text-lg font-bold">{item.label}</h3>
          {item.description ? (
            <p className="text-sm text-[var(--auth-label)]">
              {item.description}{" "}
              <span className="underline underline-offset-4">
                {learnMoreLabel}
              </span>
            </p>
          ) : null}
        </div>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        id={`account-preference-${item.key}`}
        onCheckedChange={onCheckedChange}
      />
    </article>
  );
}

function DangerZone({
  dictionary,
  disabled,
  onDeleteAccount,
}: {
  dictionary: AppDictionary;
  disabled: boolean;
  onDeleteAccount: () => void;
}) {
  return (
    <section className="mt-8 flex flex-col gap-4">
      <h2 className="text-2xl font-bold tracking-normal">
        {dictionary.account.dangerZone}
      </h2>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            className="h-12 w-fit rounded-full border border-destructive bg-transparent px-5 font-bold text-destructive hover:bg-destructive/10"
            type="button"
            variant="destructive"
          >
            {dictionary.account.deleteAccount}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <div className="flex items-start gap-3 py-1">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <CircleAlertIcon className="size-5 text-destructive" />
            </div>
            <div className="flex flex-col justify-center gap-1">
              <AlertDialogTitle className="text-sm font-semibold">
                {dictionary.account.deleteTitle}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm text-muted-foreground">
                {dictionary.account.deleteDescription}
              </AlertDialogDescription>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {dictionary.common.keepMyAccount}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled}
              onClick={onDeleteAccount}
              variant="destructive"
            >
              {disabled
                ? dictionary.common.deleting
                : dictionary.common.deleteAnyway}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function getInitialAccount(): AuthAccount | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return getAuthSession()?.account;
}

function getFormState(
  account?: Pick<AuthAccount, "locale" | "name" | "timezone">,
): AccountFormState {
  const locale = normalizeLocale(account?.locale);

  return {
    locale: toAccountLocale(locale),
    name: account?.name ?? "",
    timezone: account?.timezone ?? "Africa/Nairobi",
  };
}

function getAccountPatch(
  form: AccountFormState,
  initialForm: AccountFormState,
): UpdateAccountInput {
  return getChangedFields(form, initialForm) as UpdateAccountInput;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "Something went wrong. Please try again.";
}

function getPreferenceLabel(
  key: keyof AccountPreferences,
  preferenceItems: PreferenceItem[],
  complianceItems: PreferenceItem[],
): string {
  return (
    [...preferenceItems, ...complianceItems].find((item) => item.key === key)
      ?.label ?? "Preference"
  );
}

function buildPreferenceItems(dictionary: AppDictionary): PreferenceItem[] {
  return preferenceKeys.map((key) => ({
    key,
    label: dictionary.preferences[key].label,
    tooltip: dictionary.preferences[key].tooltip,
  }));
}

function buildComplianceItems(dictionary: AppDictionary): PreferenceItem[] {
  return (
    ["hipaa", "cfr_part_11", "knowledge_based_authentication"] as const
  ).map((key) => ({
    description: dictionary.compliance[key].description,
    key,
    label: dictionary.compliance[key].label,
    mark: complianceMarks[key],
    tooltip: dictionary.compliance[key].tooltip,
  }));
}
