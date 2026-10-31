import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { saveAuthSession, type AuthResponse } from '../../../apps/frontend/lib/api/auth';
import { useTestMode } from '../../../apps/frontend/lib/hooks/use-test-mode';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const session: AuthResponse = { access_token: 'token', user: { id: 'user', email: 'user@example.test', role: 'admin', first_name: null, last_name: null }, account: { id: 'account', name: 'Example', locale: 'en-US', timezone: 'UTC' } };
beforeEach(() => saveAuthSession(session));
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const hook = renderHook(() => useTestMode(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { ...hook, invalidate };
}
it('reacts to session changes and enables/disables test mode with cache invalidation', async () => {
  const fetchMock = vi.fn().mockImplementation(async (_url: string, request: RequestInit) => new Response(JSON.stringify({ ...session, account: { ...session.account, is_test_mode: request.method === 'POST' } })));
  vi.stubGlobal('fetch', fetchMock); const hook = setup(); expect(hook.result.current.isTestMode).toBe(false);
  act(() => hook.result.current.setTestMode(true));
  await waitFor(() => expect(hook.result.current.isTestMode).toBe(true)); expect(toast.success).toHaveBeenCalledWith('Test mode enabled');
  act(() => hook.result.current.setTestMode(false));
  await waitFor(() => expect(hook.result.current.isTestMode).toBe(false)); expect(toast.success).toHaveBeenCalledWith('Test mode disabled');
  expect(hook.invalidate).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.map(([url, request]) => [url, request.method])).toEqual([['/api/testing-account', 'POST'], ['/api/testing-account', 'DELETE']]);
});
it.each([new Error('offline'), 'unknown'])('retains the current tenant/session when test-mode switching fails', async failure => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure)); const hook = setup();
  act(() => hook.result.current.setTestMode(true)); await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Test mode could not be changed', { description: failure instanceof Error ? failure.message : undefined }));
  expect(hook.result.current.isTestMode).toBe(false); expect(hook.invalidate).not.toHaveBeenCalled();
});
