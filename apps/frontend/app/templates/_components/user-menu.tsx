"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  BotIcon,
  FileCheck2Icon,
  FlaskConicalIcon,
  LogOutIcon,
  UserRoundIcon,
} from "lucide-react";

import {
  clearAuthSession,
  getAuthSession,
  subscribeToAuthSessionChange,
} from "@/lib/api/auth";
import { useTestMode } from "@/lib/hooks/use-test-mode";
import { useAppI18n } from "@/lib/i18n/use-app-i18n";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu() {
  const router = useRouter();
  const { isPending, isTestMode, setTestMode } = useTestMode();
  const { dictionary } = useAppI18n();
  const initials = useSyncExternalStore(
    subscribeToAuthStorage,
    getUserInitialsSnapshot,
    getUserInitialsFallback,
  );

  function handleSignOut() {
    clearAuthSession();
    router.replace("/auth/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Open user menu">
        <Avatar
          className="cursor-pointer bg-[var(--auth-primary)] text-[var(--auth-primary-foreground)] ring-2 ring-transparent transition hover:ring-[var(--auth-input-border)]"
          size="lg"
        >
          <AvatarFallback className="bg-[var(--auth-primary)] text-sm font-bold text-[var(--auth-primary-foreground)]">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{dictionary.userMenu.workspace}</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem asChild><Link href="/settings/accounts">Switch account / Invitations</Link></DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings/profile">
              <UserRoundIcon data-icon="inline-start" />
              {dictionary.userMenu.profile}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings/e-signature">
              <FileCheck2Icon data-icon="inline-start" />
              {dictionary.userMenu.verifyPdf}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/ai-assistant">
              <BotIcon data-icon="inline-start" />
              {dictionary.userMenu.askAi}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem
            checked={isTestMode}
            disabled={isPending}
            onCheckedChange={setTestMode}
          >
            <FlaskConicalIcon data-icon="inline-start" />
            {dictionary.userMenu.testMode}
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut} variant="destructive">
          <LogOutIcon data-icon="inline-start" />
          {dictionary.common.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function subscribeToAuthStorage(onStoreChange: () => void): () => void {
  return subscribeToAuthSessionChange(onStoreChange);
}

function getUserInitialsSnapshot(): string {
  const session = getAuthSession();
  const fullName = [session?.user.first_name, session?.user.last_name]
    .filter(Boolean)
    .join(" ");
  const label = fullName || session?.user.email || "CO";

  return getInitials(label);
}

function getUserInitialsFallback(): string {
  return "CO";
}

function getInitials(label: string): string {
  const normalized = label.trim();

  if (!normalized) {
    return "CO";
  }

  if (normalized.includes("@")) {
    return normalized.slice(0, 2).toUpperCase();
  }

  return normalized
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
