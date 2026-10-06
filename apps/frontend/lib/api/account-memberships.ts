import { authenticatedApiFetch, saveAuthSession, type AuthResponse } from './auth';

export type AccountMembership = { id: string; name: string; role: string; status: 'active' | 'invited' | 'expired' };
export const listAccountMemberships = () => authenticatedApiFetch<AccountMembership[]>('/account-memberships');
export async function enterAccount(accountId: string, action: 'accept' | 'switch') {
  const session = await authenticatedApiFetch<AuthResponse>(`/account-memberships/${encodeURIComponent(accountId)}/${action}`, { method: 'POST' });
  saveAuthSession(session);
  // Full navigation disposes every account-scoped query and pending view subscription.
  window.location.assign('/templates');
}
