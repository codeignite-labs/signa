'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authenticatedApiFetch } from '@/lib/api/auth';
import { enterAccount } from '@/lib/api/account-memberships';

export default function AcceptTeamInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function accept() {
    setBusy(true);
    try {
      const result = await authenticatedApiFetch<{ member: { account_id: string } }>(`/team-invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' });
      await enterAccount(result.member.account_id, 'switch');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Invitation could not be accepted.'); setBusy(false); }
  }
  return <main id="main-content" className="flex min-h-svh items-center justify-center bg-[var(--auth-background)] px-6 text-[var(--auth-foreground)]">
    <section className="max-w-lg space-y-5"><h1 className="text-3xl font-bold">Join your team</h1><p>Accept this invitation using the email address it was sent to. Your existing account and password stay the same.</p>
      {error && <p role="alert">{error}</p>}<Button disabled={busy} onClick={() => void accept()}>{busy ? 'Joining…' : 'Accept invitation'}</Button>
    </section>
  </main>;
}
