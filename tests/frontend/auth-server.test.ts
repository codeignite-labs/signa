// @vitest-environment node
import { expect, it } from "vitest";
import * as auth from "../../apps/frontend/lib/api/auth";
it("keeps browser-local sessions absent during SSR rather than reading globals or redirecting", async () => {
  expect(auth.getAuthSession()).toBeNull();
  expect(auth.getAuthToken()).toBeNull();
  auth.saveAuthSession({} as auth.AuthResponse);
  auth.clearAuthSession();
  auth.subscribeToAuthSessionChange(() => {})();
  await expect(auth.authenticatedApiFetch("/private")).rejects.toMatchObject({
    status: 401,
  });
});
