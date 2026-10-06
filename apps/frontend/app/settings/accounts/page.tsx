'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SettingsHeader } from '../_components/settings-header';
import { Button } from '@/components/ui/button';
import { getAuthSession } from '@/lib/api/auth';
import { enterAccount, listAccountMemberships, type AccountMembership } from '@/lib/api/account-memberships';

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountMembership[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => { listAccountMemberships().then(setAccounts).catch(() => setError('Accounts could not be loaded.')).finally(() => setLoading(false)); }, []);
  async function enter(account: AccountMembership) {
    setBusy(true);
    try { await enterAccount(account.id, account.status === 'invited' ? 'accept' : 'switch'); }
    catch (failure) { toast.error(failure instanceof Error ? failure.message : 'Unable to open account'); setBusy(false); }
  }
  return <main id="main-content" className="min-h-svh bg-[var(--auth-background)] text-[var(--auth-foreground)]">
    <div className="mx-auto max-w-6xl space-y-8 px-5 py-4">
      <SettingsHeader />
      <section className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-3xl font-bold">Your accounts</h1>
        <p className="text-muted-foreground">Use the same login across organizations. Each account has its own documents, branding and permissions.</p>
        {loading && <p role="status">Loading accounts…</p>}
        {error && <p role="alert">{error}</p>}
        {accounts.map((account) => <div key={account.id} className="flex items-center justify-between gap-4 border-b border-border py-5">
          <div className="min-w-0"><h2 className="truncate font-semibold">{account.name}</h2><p className="text-sm capitalize text-muted-foreground">{account.role} · {account.status}</p></div>
          <Button disabled={busy || account.status === 'expired' || (account.status === 'active' && String(getAuthSession()?.account.id) === String(account.id))} onClick={() => void enter(account)}>
            {account.status === 'invited' ? 'Accept invitation' : account.status === 'expired' ? 'Invitation expired' : String(getAuthSession()?.account.id) === String(account.id) ? 'Current account' : 'Switch account'}
          </Button>
        </div>)}
      </section>
    </div>
  </main>;
}
