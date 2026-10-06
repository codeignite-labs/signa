"use client";

import { useAccountBranding } from "@/components/branding/account-branding-provider";
import Link from "next/link";
import { ArrowLeftIcon, BotIcon, CircleHelpIcon, InfoIcon } from "lucide-react";

import type { AppDictionary } from "@/lib/i18n/app-dictionaries";
import { useAppI18n } from "@/lib/i18n/use-app-i18n";
import { useTestMode } from "@/lib/hooks/use-test-mode";

type SettingsSidebarItem = {
  href?: string;
  key: SettingsSection;
  badge?: string;
  disabled?: boolean;
};

const settingsLinks: readonly SettingsSidebarItem[] = [
  { href: "/settings/profile", key: "Profile" },
  { href: "/settings/account", key: "Account" },
  { href: "/settings/notifications", key: "Notifications" },
  { href: "/settings/e-signature", key: "E-Signature" },
  { href: "/settings/personalization", key: "Personalization" },
  { href: "/settings/users", key: "Users" },
  { href: "/settings/teams", key: "Teams" },
  { href: "/settings/integrations", key: "Integrations" },
  { href: "/settings/webhooks", key: "Webhooks" },
  { badge: "license", href: "/settings/plans", key: "Plans" },
  { href: "/settings/api", key: "API" },
  { disabled: true, key: "Embedding" },
];

type SettingsSection =
  | "Account"
  | "API"
  | "E-Signature"
  | "Embedding"
  | "Integrations"
  | "Notifications"
  | "Personalization"
  | "Plans"
  | "Profile"
  | "Teams"
  | "Users"
  | "Webhooks";

export function SettingsSidebar({ active }: { active: SettingsSection }) {
  const { isPending, isTestMode, setTestMode } = useTestMode();
  const { dictionary } = useAppI18n();
  const branding = useAccountBranding();

  return (
    <aside className="w-full shrink-0 md:w-52">
      <Link
        className="mb-4 flex items-center gap-1 text-sm font-medium hover:text-[var(--auth-primary)]"
        href="/templates"
      >
        <ArrowLeftIcon data-icon="inline-start" />
        {dictionary.common.back}
      </Link>
      <p className="mb-3 border-b border-border pb-3 text-sm font-bold text-[var(--auth-label)]">
        {dictionary.common.settings}
      </p>
      <nav
        aria-label="Settings sections"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
      >
        {settingsLinks.map((item) => {
          const label = getSettingsLabel(dictionary, item.key);
          const badge = item.badge ? dictionary.settings.license : undefined;

          return item.disabled ? (
            <span
              className="shrink-0 rounded-full px-4 py-2 text-base text-muted-foreground md:shrink"
              key={`${item.key}:disabled`}
            >
              <span className="flex cursor-default items-center justify-between gap-3">
                {label}
                {badge ? (
                  <span className="rounded-full bg-[var(--auth-upgrade)] px-2 py-0.5 text-xs font-bold text-[var(--auth-primary)]">
                    {badge}
                  </span>
                ) : null}
              </span>
            </span>
          ) : (
            <Link
              className={
                item.key === active
                  ? "shrink-0 rounded-full bg-[var(--auth-muted)] px-4 py-2 text-base focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:shrink"
                  : "shrink-0 rounded-full px-4 py-2 text-base hover:bg-[var(--auth-muted)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:shrink"
              }
              href={item.href ?? "#"}
              key={`${item.key}:${item.href}`}
            >
              <span className="flex items-center justify-between gap-3">
                {label}
                {badge ? (
                  <span className="rounded-full bg-[var(--auth-upgrade)] px-2 py-0.5 text-xs font-bold text-[var(--auth-primary)]">
                    {badge}
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}
        <label className="mt-0 flex shrink-0 cursor-pointer items-center gap-3 rounded-full px-4 py-2 text-base hover:bg-[var(--auth-muted)] md:mt-1 md:justify-between">
          <span>{dictionary.common.testMode}</span>
          <input
            checked={isTestMode}
            className="accent-[var(--auth-primary)]"
            disabled={isPending}
            onChange={(event) => setTestMode(event.target.checked)}
            type="checkbox"
          />
        </label>
      </nav>
      {branding !== undefined && !branding?.white_label && <div className="mx-4 mt-4 hidden border-t border-border pt-3 text-sm md:block">
        <p>{dictionary.settings.help}</p>
        <div className="mt-4 flex gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-[var(--auth-muted)]">
            <CircleHelpIcon data-icon="inline-start" />
          </span>
          <span className="flex size-10 items-center justify-center rounded-full bg-[var(--auth-muted)]">
            <BotIcon data-icon="inline-start" />
          </span>
          <span className="flex size-10 items-center justify-center rounded-full bg-[var(--auth-muted)]">
            <InfoIcon data-icon="inline-start" />
          </span>
        </div>
        <a
          className="mt-4 block underline underline-offset-4"
          href="mailto:support@signa.local"
        >
          support@signa.local
        </a>
      </div>}
    </aside>
  );
}

function getSettingsLabel(
  dictionary: AppDictionary,
  section: SettingsSection,
): string {
  const labels: Record<SettingsSection, string> = {
    Account: dictionary.settings.nav.account,
    API: dictionary.settings.nav.api,
    "E-Signature": dictionary.settings.nav.eSignature,
    Embedding: dictionary.settings.nav.embedding,
    Integrations: dictionary.settings.nav.integrations,
    Notifications: dictionary.settings.nav.notifications,
    Personalization: dictionary.settings.nav.personalization,
    Plans: dictionary.settings.nav.plans,
    Profile: dictionary.settings.nav.profile,
    Teams: dictionary.settings.nav.teams,
    Users: dictionary.settings.nav.users,
    Webhooks: dictionary.settings.nav.webhooks,
  };

  return labels[section];
}
