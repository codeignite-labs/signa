import { beforeEach, expect, it, vi } from "vitest";
import * as api from "../../../apps/frontend/lib/api/auth";
import * as teams from "../../../apps/frontend/lib/api/teams";
import * as webhooks from "../../../apps/frontend/lib/api/webhooks";
import { verifyPdfFile } from "../../../apps/frontend/lib/api/tools";
const file = new File(["document"], "document.pdf", {
  type: "application/pdf",
});
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  api.saveAuthSession({
    access_token: "test-token",
    user: {
      id: "user",
      email: "user@example.test",
      role: "admin",
      first_name: null,
      last_name: null,
    },
    account: {
      id: "account",
      name: "Example",
      locale: "en-US",
      timezone: "UTC",
    },
  });
  fetchMock = vi
    .fn()
    .mockImplementation(async () => new Response('{"data":[],"id":"result"}'));
  vi.stubGlobal("fetch", fetchMock);
});
const requests: Array<
  [string, () => Promise<unknown>, string, string, unknown?]
> = [
  [
    "login",
    () => api.login({ email: "user@example.test", password: "test" }),
    "/auth/login",
    "POST",
    { email: "user@example.test", password: "test" },
  ],
  [
    "register",
    () =>
      api.register({
        email: "user@example.test",
        password: "test",
        account_name: "Example",
        first_name: "A",
        last_name: "B",
      }),
    "/auth/register",
    "POST",
    {
      email: "user@example.test",
      password: "test",
      account_name: "Example",
      first_name: "A",
      last_name: "B",
    },
  ],
  [
    "registration status",
    () => api.getRegistrationStatus(),
    "/auth/registration-status",
    "GET",
  ],
  [
    "Google auth start",
    () => api.startSocialAuth("google", { mode: "login" }),
    "/auth/oauth/google/start",
    "POST",
    { mode: "login" },
  ],
  [
    "Google callback",
    () => api.completeSocialAuth("google", { code: "code", state: "state" }),
    "/auth/oauth/google/callback",
    "POST",
    { code: "code", state: "state" },
  ],
  ["profile", () => api.getProfile(), "/profile", "GET"],
  [
    "password change",
    () =>
      api.updatePassword({
        current_password: "old",
        password: "new-password",
        password_confirmation: "new-password",
      }),
    "/profile/password",
    "PATCH",
    {
      current_password: "old",
      password: "new-password",
      password_confirmation: "new-password",
    },
  ],
  [
    "signature read",
    () => api.getProfileAsset("signature"),
    "/profile/signature",
    "GET",
  ],
  [
    "initials delete",
    () => api.deleteProfileAsset("initials"),
    "/profile/initials",
    "DELETE",
  ],
  ["MFA status", () => api.getMfaStatus(), "/profile/mfa", "GET"],
  ["MFA setup", () => api.startMfaSetup(), "/profile/mfa/setup", "POST"],
  [
    "MFA enable",
    () => api.enableMfa("123456"),
    "/profile/mfa",
    "POST",
    { otp_attempt: "123456" },
  ],
  [
    "MFA disable",
    () => api.disableMfa("123456"),
    "/profile/mfa",
    "DELETE",
    { otp_attempt: "123456" },
  ],
  ["account", () => api.getAccount(), "/account", "GET"],
  [
    "preferences",
    () => api.getAccountPreferences(),
    "/account/preferences",
    "GET",
  ],
  [
    "preference update",
    () => api.updateAccountPreferences({ with_signature_id: true }),
    "/account/preferences",
    "PATCH",
    { with_signature_id: true },
  ],
  ["logo read", () => api.getAccountLogo(), "/account/logo", "GET"],
  ["logo delete", () => api.deleteAccountLogo(), "/account/logo", "DELETE"],
  [
    "certificates",
    () => api.listSigningCertificates(),
    "/account/signing-certificates",
    "GET",
  ],
  [
    "timestamp service",
    () => api.updateSigningTimestampServer(null),
    "/account/signing-certificates/timestamp-server",
    "PATCH",
    { timestamp_server_url: null },
  ],
  [
    "active identity",
    () => api.makeDefaultSigningCertificate("Identity"),
    "/account/signing-certificates/active",
    "PATCH",
    { name: "Identity" },
  ],
  [
    "delete identity",
    () => api.deleteSigningCertificate("Identity"),
    "/account/signing-certificates",
    "DELETE",
    { name: "Identity" },
  ],
  [
    "trust roots",
    () => api.listSigningTrustRoots(),
    "/account/signing-trust-roots",
    "GET",
  ],
  [
    "delete trust root",
    () => api.deleteSigningTrustRoot("42"),
    "/account/signing-trust-roots/42",
    "DELETE",
  ],
  [
    "email integration start",
    () => api.connectAccountEmailIntegration("gmail"),
    "/account/integrations/gmail/connect",
    "POST",
  ],
  [
    "email integration callback",
    () =>
      api.completeAccountEmailIntegration("gmail", {
        code: "code",
        state: null,
      }),
    "/account/integrations/gmail/callback",
    "POST",
    { code: "code", state: null },
  ],
  [
    "email integration delete",
    () => api.disconnectAccountEmailIntegration("gmail"),
    "/account/integrations/gmail",
    "DELETE",
  ],
  ["API token", () => api.getApiToken(), "/auth/api-token", "GET"],
  [
    "API token reveal",
    () => api.revealApiToken("password"),
    "/auth/api-token/reveal",
    "POST",
    { password: "password" },
  ],
  [
    "API token rotate",
    () =>
      api.rotateApiToken({
        password: "password",
        permissions: ["templates:read"],
      }),
    "/auth/api-token/rotate",
    "POST",
    { password: "password", permissions: ["templates:read"] },
  ],
  [
    "API token restrict",
    () => api.updateApiTokenPermissions(["users:read"]),
    "/auth/api-token/permissions",
    "PATCH",
    { permissions: ["users:read"] },
  ],
  ["active users", () => api.listUsers(), "/users?status=active", "GET"],
  [
    "archived users",
    () => api.listUsers("archived"),
    "/users?status=archived",
    "GET",
  ],
  [
    "create user",
    () => api.createUser({ email: "new@example.test", role: "viewer" }),
    "/users",
    "POST",
    { email: "new@example.test", role: "viewer" },
  ],
  [
    "import users",
    () => api.importUsers([{ email: "new@example.test" }]),
    "/users/import",
    "POST",
    { users: [{ email: "new@example.test" }] },
  ],
  [
    "update user",
    () => api.updateUser("42", { role: "viewer" }),
    "/users/42",
    "PATCH",
    { role: "viewer" },
  ],
  ["archive user", () => api.archiveUser("42"), "/users/42", "DELETE"],
  ["active teams", () => teams.listTeams(), "/teams?status=active", "GET"],
  [
    "archived teams",
    () => teams.listTeams("archived"),
    "/teams?status=archived",
    "GET",
  ],
  [
    "create team",
    () => teams.createTeam({ name: "Reviewers" }),
    "/teams",
    "POST",
    { name: "Reviewers" },
  ],
  [
    "update team",
    () => teams.updateTeam("42", { description: "Updated" }),
    "/teams/42",
    "PATCH",
    { description: "Updated" },
  ],
  ["archive team", () => teams.archiveTeam("42"), "/teams/42", "DELETE"],
  [
    "team members",
    () => teams.listTeamMembers("42"),
    "/teams/42/members",
    "GET",
  ],
  [
    "add member",
    () => teams.addTeamMember("42", { user_id: "3", role: "member" }),
    "/teams/42/members",
    "POST",
    { user_id: "3", role: "member" },
  ],
  [
    "update member",
    () => teams.updateTeamMember("42", "3", { role: "viewer" }),
    "/teams/42/members/3",
    "PATCH",
    { role: "viewer" },
  ],
  [
    "remove member",
    () => teams.removeTeamMember("42", "3"),
    "/teams/42/members/3",
    "DELETE",
  ],
  [
    "team invites",
    () => teams.listTeamInvitations("42"),
    "/teams/42/invitations",
    "GET",
  ],
  [
    "create invite",
    () => teams.createTeamInvitation("42", { email: "invite@example.test" }),
    "/teams/42/invitations",
    "POST",
    { email: "invite@example.test" },
  ],
  [
    "revoke invite",
    () => teams.revokeTeamInvitation("42", "3"),
    "/teams/42/invitations/3",
    "DELETE",
  ],
  ["webhooks", () => webhooks.listWebhooks(), "/webhooks", "GET"],
  [
    "create webhook",
    () =>
      webhooks.createWebhook({
        url: "https://hooks.example",
        events: ["form.completed"],
      }),
    "/webhooks",
    "POST",
    { url: "https://hooks.example", events: ["form.completed"] },
  ],
  [
    "update webhook",
    () => webhooks.updateWebhook("42", { events: [] }),
    "/webhooks/42",
    "PATCH",
    { events: [] },
  ],
  [
    "delete webhook",
    () => webhooks.deleteWebhook("42"),
    "/webhooks/42",
    "DELETE",
  ],
  [
    "test webhook",
    () => webhooks.testWebhook("42"),
    "/webhooks/42/test",
    "POST",
  ],
  [
    "webhook events",
    () => webhooks.listWebhookEvents("42"),
    "/webhooks/42/events",
    "GET",
  ],
  [
    "webhook event status",
    () => webhooks.listWebhookEvents("42", "error"),
    "/webhooks/42/events?status=error",
    "GET",
  ],
  [
    "webhook resend",
    () => webhooks.resendWebhookEvent("42"),
    "/webhook-events/42/resend",
    "POST",
  ],
];
it.each(requests)(
  "%s preserves the public route, verb and payload",
  async (_name, send, path, method, body) => {
    await send();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api" + path);
    expect(init.method ?? "GET").toBe(method);
    if (body !== undefined) expect(JSON.parse(init.body)).toEqual(body);
    if (
      !path.startsWith("/auth/login") &&
      !path.startsWith("/auth/register") &&
      !path.startsWith("/auth/registration") &&
      !path.startsWith("/auth/oauth")
    )
      expect(init.headers.get("Authorization")).toBe("Bearer test-token");
  },
);
it("unwraps integrations and supplies a deterministic provider state key", async () => {
  expect(await api.listAccountEmailIntegrations()).toEqual([]);
  expect(api.getSocialAuthStateKey("google")).toBe("signa.oauth.google.state");
});
it.each([
  [
    "profile",
    () => api.uploadProfileAsset("signature", file),
    "/profile/signature",
  ],
  ["logo", () => api.uploadAccountLogo(file), "/account/logo"],
  [
    "identity",
    () => api.uploadSigningCertificate(file, "Identity"),
    "/account/signing-certificates",
  ],
  [
    "trust root",
    () => api.uploadSigningTrustRoot(file, "Authority"),
    "/account/signing-trust-roots",
  ],
  ["PDF verification", () => verifyPdfFile(file), "/tools/verify"],
] as const)(
  "uploads %s as multipart without forcing a JSON content type",
  async (_name, send, path) => {
    await send();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api" + path);
    expect(init.method).toBe("POST");
    expect(init.body.get("file").name).toBe("document.pdf");
    expect(init.headers.has("Content-Type")).toBe(false);
  },
);
it("passes identity passphrases only in the upload body", async () => {
  await api.uploadSigningCertificate(file, "Identity", "passphrase");
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).not.toContain("passphrase");
  expect(init.body.get("password")).toBe("passphrase");
  expect(init.body.get("name")).toBe("Identity");
});
