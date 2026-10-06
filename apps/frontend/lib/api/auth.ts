import { clearBrandingCache } from "@/lib/branding/branding-cache";
import { ApiError, apiFetch } from "./http";
import type { SignaRole } from "@repo/shared";
import { normalizeLocale, persistLocale } from "@/lib/i18n/config";

const authStorageKey = "signa.auth";
const authStorageEvent = "signa.auth.changed";
const tokenExpirySkewSeconds = 15;

export type AuthUser = {
  membership_status?: string;
  shared_identity?: boolean;
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: SignaRole;
  otp_required_for_login?: boolean;
  archived_at?: string | null;
};

export type AuthAccount = {
  id: string;
  name: string;
  timezone: string;
  locale: string;
  archived_at?: string | null;
  is_test_mode?: boolean;
  production_account_id?: string | null;
  testing_account_id?: string | null;
};

export type AuthResponse = {
  access_token: string;
  user: AuthUser;
  account: AuthAccount;
};

export type LoginInput = {
  email: string;
  otp_attempt?: string;
  password: string;
};

export type RegisterInput = LoginInput & {
  account_name: string;
  first_name: string;
  last_name: string;
  locale?: string;
  timezone?: string;
};

export type RegistrationStatus = {
  mode: "open" | "initial_only" | "disabled";
  can_register: boolean;
  reason: string | null;
};

export type UpdateProfileInput = {
  first_name?: string;
  last_name?: string;
  email?: string;
};

export type UpdateAccountInput = {
  locale?: string;
  name?: string;
  timezone?: string;
};

export type AccountPreferences = {
  bcc_emails: string;
  receive_completed_email: boolean;
  submitter_reminders: SubmitterReminders;
  allow_to_decline: boolean;
  allow_to_delegate: boolean;
  allow_to_resubmit: boolean;
  allow_typed_signature: boolean;
  cfr_part_11: boolean;
  combine_pdf_result_key: boolean;
  download_links_auth: boolean;
  download_links_expire: boolean;
  enforce_signing_order: boolean;
  force_mfa: boolean;
  form_prefill_signature: boolean;
  auto_sign_owner_enabled: boolean;
  auto_sign_owner_role: string;
  auto_sign_owner_send_email: boolean;
  hipaa: boolean;
  knowledge_based_authentication: boolean;
  require_signing_reason: boolean;
  with_file_links: boolean;
  with_signature_id: boolean;
  esigning_preference: "single" | "multiple";
  flatten_result_pdf: boolean;
  document_filename_format: DocumentFilenameFormat;
  submitter_invitation_email: AccountEmailTemplate;
  submitter_documents_copy_email: AccountDocumentsCopyEmailTemplate;
  submitter_completed_email: AccountCompletedEmailTemplate;
  form_completed_message: CompletedFormMessage;
  form_completed_button: CompletedFormButton;
  form_with_confetti: boolean;
  policy_links: string;
};

export type SubmitterReminders = {
  first_duration: string | null;
  second_duration: string | null;
  third_duration: string | null;
};

export type DocumentFilenameFormat =
  | "{document.name}"
  | "{document.name} - {submission.status}"
  | "{document.name} - {submission.submitters}"
  | "{document.name} - {submission.submitters} - {submission.completed_at}";

export type AccountEmailTemplate = {
  subject: string;
  body: string;
  reply_to?: string | null;
};

export type AccountDocumentsCopyEmailTemplate = AccountEmailTemplate & {
  attach_audit_log: boolean;
  attach_documents: boolean;
  enabled: boolean;
};

export type AccountCompletedEmailTemplate = AccountEmailTemplate & {
  attach_audit_log: boolean;
  attach_documents: boolean;
};

export type CompletedFormMessage = {
  title?: string;
  body?: string;
};

export type CompletedFormButton = {
  title?: string;
  url?: string;
};

export type AccountLogo = {
  uuid: string;
  filename: string;
  content_type: string | null;
  url: string;
};

export type ProfileAsset = {
  uuid: string;
  filename: string;
  content_type: string | null;
  url: string;
};

export type MfaSetup = {
  secret: string;
  provisioning_uri: string;
  otp_required_for_login: boolean;
};

export type MfaStatus = {
  otp_required_for_login: boolean;
};

export type SigningCertificate = {
  is_active: boolean;
  fingerprint_sha256: string | null;
  issuer: string | null;
  name: string;
  filename?: string;
  serial_number: string | null;
  status: "active" | "default";
  subject: string | null;
  valid_from: string | null;
  valid_to: string | null;
};

export type SigningCertificateList = {
  data: SigningCertificate[];
  timestamp_server_url: string | null;
};

export type SigningTrustRoot = {
  created_at: string;
  enabled: boolean;
  fingerprint_sha256: string;
  id: string;
  issuer: string;
  name: string;
  serial_number: string;
  subject: string;
  valid_from: string;
  valid_to: string;
};

export type SigningTrustRootList = {
  data: SigningTrustRoot[];
};

export type AccountEmailIntegrationProvider = "gmail";

export type SocialAuthProvider = "google";

export type SocialAuthStartResponse = {
  state: string;
  url: string;
};

export type AccountEmailIntegration = {
  provider: AccountEmailIntegrationProvider;
  name: string;
  connected: boolean;
  configured: boolean;
  email: string | null;
  connected_at: string | null;
};

export type AccountEmailIntegrationConnectResponse = {
  provider: AccountEmailIntegrationProvider;
  connected: boolean;
  configured: boolean;
  url: string | null;
};

export const apiTokenPermissions = [
  "templates:read",
  "templates:write",
  "submissions:read",
  "submissions:write",
  "submitters:read",
  "submitters:write",
  "webhooks:read",
  "webhooks:write",
  "tools:use",
  "users:read",
  "users:write",
] as const;

export type ApiTokenPermission = (typeof apiTokenPermissions)[number];

export type ApiToken = {
  id: string;
  token: string;
  role: SignaRole | "unknown";
  permissions: ApiTokenPermission[];
  permissions_note: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

export type RevealedApiToken = ApiToken & {
  revealed_token: string;
};

export type UpdateAccountPreferencesInput = Partial<AccountPreferences>;

export type UserStatus = "active" | "archived";

export type CreateUserInput = {
  email: string;
  first_name?: string;
  last_name?: string;
  password?: string;
  role?: SignaRole;
};

export type UpdateUserInput = Partial<CreateUserInput> & {
  otp_required_for_login?: boolean;
};

export type ImportUserInput = {
  email: string;
  first_name?: string;
  last_name?: string;
  role?: SignaRole;
  team?: string;
};

export type ImportUserResult = {
  row: number;
  email: string;
  status: "created" | "restored" | "skipped" | "failed";
  message?: string;
};

export type ImportUsersResponse = {
  results: ImportUserResult[];
  total: number;
  created: number;
  restored: number;
  skipped: number;
  failed: number;
};

export function login(input: LoginInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/auth/login", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/auth/register", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export function getRegistrationStatus(): Promise<RegistrationStatus> {
  return apiFetch<RegistrationStatus>("/auth/registration-status");
}

export function startSocialAuth(
  provider: SocialAuthProvider,
  input: { mode: "login" | "register" },
): Promise<SocialAuthStartResponse> {
  return apiFetch<SocialAuthStartResponse>(`/auth/oauth/${provider}/start`, {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export function completeSocialAuth(
  provider: SocialAuthProvider,
  input: { code: string; state: string },
): Promise<AuthResponse> {
  return apiFetch<AuthResponse>(`/auth/oauth/${provider}/callback`, {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export function getSocialAuthStateKey(provider: SocialAuthProvider): string {
  return `signa.oauth.${provider}.state`;
}

export function saveAuthSession(session: AuthResponse): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(authStorageKey, JSON.stringify(session));
  persistLocale(normalizeLocale(session.account.locale));
  window.dispatchEvent(new Event(authStorageEvent));
}

export function getAuthSession(): AuthResponse | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawSession = window.localStorage.getItem(authStorageKey);

  if (!rawSession) {
    return null;
  }

  try {
    const session = JSON.parse(rawSession) as AuthResponse;

    if (isAuthSessionExpired(session)) {
      clearAuthSession();
      return null;
    }

    return session;
  } catch {
    window.localStorage.removeItem(authStorageKey);
    return null;
  }
}

export function getAuthToken(): string | null {
  return getAuthSession()?.access_token ?? null;
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(authStorageKey);
  clearBrandingCache();
  window.dispatchEvent(new Event(authStorageEvent));
}

export function subscribeToAuthSessionChange(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener("storage", listener);
  window.addEventListener(authStorageEvent, listener);

  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(authStorageEvent, listener);
  };
}

export function getProfile(): Promise<AuthUser> {
  return authenticatedApiFetch<AuthUser>("/profile");
}

export function updatePassword(input: {
  current_password: string;
  password: string;
  password_confirmation: string;
}): Promise<AuthUser> {
  return authenticatedApiFetch<AuthUser>("/profile/password", {
    body: JSON.stringify(input),
    method: "PATCH",
  });
}

export function getProfileAsset(
  key: "signature" | "initials",
): Promise<ProfileAsset | null> {
  return authenticatedApiFetch<ProfileAsset | null>(`/profile/${key}`);
}

export function uploadProfileAsset(
  key: "signature" | "initials",
  file: File,
): Promise<ProfileAsset> {
  const formData = new FormData();

  formData.set("file", file, file.name);

  return authenticatedApiFetch<ProfileAsset>(`/profile/${key}`, {
    body: formData,
    method: "POST",
  });
}

export function deleteProfileAsset(
  key: "signature" | "initials",
): Promise<null> {
  return authenticatedApiFetch<null>(`/profile/${key}`, {
    method: "DELETE",
  });
}

export function getMfaStatus(): Promise<MfaStatus> {
  return authenticatedApiFetch<MfaStatus>("/profile/mfa");
}

export function startMfaSetup(): Promise<MfaSetup> {
  return authenticatedApiFetch<MfaSetup>("/profile/mfa/setup", {
    method: "POST",
  });
}

export function enableMfa(otpAttempt: string): Promise<MfaStatus> {
  return authenticatedApiFetch<MfaStatus>("/profile/mfa", {
    body: JSON.stringify({ otp_attempt: otpAttempt }),
    method: "POST",
  });
}

export function disableMfa(otpAttempt: string): Promise<MfaStatus> {
  return authenticatedApiFetch<MfaStatus>("/profile/mfa", {
    body: JSON.stringify({ otp_attempt: otpAttempt }),
    method: "DELETE",
  });
}

export function getAccount(): Promise<AuthAccount> {
  return authenticatedApiFetch<AuthAccount>("/account");
}

export async function deleteAccount(): Promise<AuthAccount> {
  const account = await authenticatedApiFetch<AuthAccount>("/account", {
    method: "DELETE",
  });

  clearAuthSession();

  return account;
}

export async function updateProfile(
  input: UpdateProfileInput,
): Promise<AuthUser> {
  const user = await authenticatedApiFetch<AuthUser>("/profile", {
    body: JSON.stringify(input),
    method: "PATCH",
  });

  mergeAuthUserSession(user);

  return user;
}

export async function updateAccount(
  input: UpdateAccountInput,
): Promise<AuthAccount> {
  const account = await authenticatedApiFetch<AuthAccount>("/account", {
    body: JSON.stringify(input),
    method: "PATCH",
  });

  mergeAuthAccountSession(account);

  return account;
}

export function getAccountPreferences(): Promise<AccountPreferences> {
  return authenticatedApiFetch<AccountPreferences>("/account/preferences");
}

export function updateAccountPreferences(
  input: UpdateAccountPreferencesInput,
): Promise<AccountPreferences> {
  return authenticatedApiFetch<AccountPreferences>("/account/preferences", {
    body: JSON.stringify(input),
    method: "PATCH",
  });
}

export function getAccountLogo(): Promise<AccountLogo | null> {
  return authenticatedApiFetch<AccountLogo | null>("/account/logo");
}

export function uploadAccountLogo(file: File): Promise<AccountLogo> {
  const formData = new FormData();

  formData.set("file", file, file.name);

  return authenticatedApiFetch<AccountLogo>("/account/logo", {
    body: formData,
    method: "POST",
  });
}

export function deleteAccountLogo(): Promise<AccountLogo | null> {
  return authenticatedApiFetch<AccountLogo | null>("/account/logo", {
    method: "DELETE",
  });
}

export function listSigningCertificates(): Promise<SigningCertificateList> {
  return authenticatedApiFetch<SigningCertificateList>(
    "/account/signing-certificates",
  );
}

export function uploadSigningCertificate(
  file: File,
  name: string,
  password = "",
): Promise<SigningCertificate> {
  const formData = new FormData();

  formData.set("name", name);
  formData.set("password", password);
  formData.set("file", file, file.name);

  return authenticatedApiFetch<SigningCertificate>(
    "/account/signing-certificates",
    {
      body: formData,
      method: "POST",
    },
  );
}

export function updateSigningTimestampServer(
  timestamp_server_url: string | null,
): Promise<SigningCertificateList> {
  return authenticatedApiFetch<SigningCertificateList>(
    "/account/signing-certificates/timestamp-server",
    {
      body: JSON.stringify({ timestamp_server_url }),
      method: "PATCH",
    },
  );
}

export function makeDefaultSigningCertificate(
  name: string,
): Promise<SigningCertificate> {
  return authenticatedApiFetch<SigningCertificate>(
    "/account/signing-certificates/active",
    {
      body: JSON.stringify({ name }),
      method: "PATCH",
    },
  );
}

export function deleteSigningCertificate(
  name: string,
): Promise<SigningCertificate> {
  return authenticatedApiFetch<SigningCertificate>(
    "/account/signing-certificates",
    {
      body: JSON.stringify({ name }),
      method: "DELETE",
    },
  );
}

export function listSigningTrustRoots(): Promise<SigningTrustRootList> {
  return authenticatedApiFetch<SigningTrustRootList>(
    "/account/signing-trust-roots",
  );
}

export function uploadSigningTrustRoot(
  file: File,
  name: string,
): Promise<SigningTrustRoot> {
  const formData = new FormData();

  formData.set("name", name);
  formData.set("file", file, file.name);

  return authenticatedApiFetch<SigningTrustRoot>(
    "/account/signing-trust-roots",
    {
      body: formData,
      method: "POST",
    },
  );
}

export function deleteSigningTrustRoot(id: string): Promise<SigningTrustRoot> {
  return authenticatedApiFetch<SigningTrustRoot>(
    `/account/signing-trust-roots/${id}`,
    {
      method: "DELETE",
    },
  );
}

export async function listAccountEmailIntegrations(): Promise<
  AccountEmailIntegration[]
> {
  const response = await authenticatedApiFetch<{
    data: AccountEmailIntegration[];
  }>("/account/integrations");

  return response.data;
}

export function connectAccountEmailIntegration(
  provider: AccountEmailIntegrationProvider,
): Promise<AccountEmailIntegrationConnectResponse> {
  return authenticatedApiFetch<AccountEmailIntegrationConnectResponse>(
    `/account/integrations/${provider}/connect`,
    { method: "POST" },
  );
}

export function completeAccountEmailIntegration(
  provider: AccountEmailIntegrationProvider,
  input: { code: string; state?: string | null },
): Promise<AccountEmailIntegration> {
  return authenticatedApiFetch<AccountEmailIntegration>(
    `/account/integrations/${provider}/callback`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
  );
}

export function disconnectAccountEmailIntegration(
  provider: AccountEmailIntegrationProvider,
): Promise<AccountEmailIntegration> {
  return authenticatedApiFetch<AccountEmailIntegration>(
    `/account/integrations/${provider}`,
    { method: "DELETE" },
  );
}

export function getApiToken(): Promise<ApiToken> {
  return authenticatedApiFetch<ApiToken>("/auth/api-token");
}

export async function startTestingAccount(): Promise<AuthResponse> {
  const session = await authenticatedApiFetch<AuthResponse>(
    "/testing-account",
    {
      method: "POST",
    },
  );

  saveAuthSession(session);

  return session;
}

export async function stopTestingAccount(): Promise<AuthResponse> {
  const session = await authenticatedApiFetch<AuthResponse>(
    "/testing-account",
    {
      method: "DELETE",
    },
  );

  saveAuthSession(session);

  return session;
}

export function revealApiToken(password: string): Promise<RevealedApiToken> {
  return authenticatedApiFetch<RevealedApiToken>("/auth/api-token/reveal", {
    body: JSON.stringify({ password }),
    method: "POST",
  });
}

export function rotateApiToken(input: {
  password: string;
  permissions?: ApiTokenPermission[];
}): Promise<RevealedApiToken> {
  return authenticatedApiFetch<RevealedApiToken>("/auth/api-token/rotate", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export function updateApiTokenPermissions(
  permissions: ApiTokenPermission[],
): Promise<ApiToken> {
  return authenticatedApiFetch<ApiToken>("/auth/api-token/permissions", {
    body: JSON.stringify({ permissions }),
    method: "PATCH",
  });
}

export function listUsers(status: UserStatus = "active"): Promise<AuthUser[]> {
  return authenticatedApiFetch<AuthUser[]>(`/users?status=${status}`);
}

export function createUser(input: CreateUserInput): Promise<AuthUser> {
  return authenticatedApiFetch<AuthUser>("/users", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export function importUsers(
  users: ImportUserInput[],
): Promise<ImportUsersResponse> {
  return authenticatedApiFetch<ImportUsersResponse>("/users/import", {
    body: JSON.stringify({ users }),
    method: "POST",
  });
}

export function updateUser(
  userId: string,
  input: UpdateUserInput,
): Promise<AuthUser> {
  return authenticatedApiFetch<AuthUser>(`/users/${userId}`, {
    body: JSON.stringify(input),
    method: "PATCH",
  });
}

export function archiveUser(userId: string): Promise<AuthUser> {
  return authenticatedApiFetch<AuthUser>(`/users/${userId}`, {
    method: "DELETE",
  });
}

export function authenticatedApiFetch<TResponse>(
  path: string,
  init?: RequestInit,
): Promise<TResponse> {
  const token = getAuthToken();

  if (!token) {
    redirectToLogin();
    return Promise.reject(new ApiError("Not authenticated", 401));
  }

  const headers = new Headers(init?.headers);

  headers.set("Authorization", `Bearer ${token}`);

  return apiFetch<TResponse>(path, {
    ...init,
    headers,
  }).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      clearAuthSession();
      redirectToLogin();
    }

    throw error;
  });
}

function isAuthSessionExpired(session: AuthResponse): boolean {
  const expiresAt = getJwtExpiresAt(session.access_token);

  if (!expiresAt) {
    return false;
  }

  return expiresAt <= Date.now() + tokenExpirySkewSeconds * 1000;
}

function getJwtExpiresAt(token: string): number | null {
  const [, payload] = token.split(".");

  if (!payload) {
    return null;
  }

  try {
    const decoded = JSON.parse(atob(toBase64(payload))) as { exp?: unknown };

    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

function toBase64(base64Url: string): string {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4;

  return padding ? `${base64}${"=".repeat(4 - padding)}` : base64;
}

function redirectToLogin(): void {
  if (typeof window === "undefined") {
    return;
  }

  const next = `${window.location.pathname}${window.location.search}`;

  if (window.location.pathname.startsWith("/auth")) {
    return;
  }

  window.location.replace(`/auth/login?next=${encodeURIComponent(next)}`);
}

function mergeAuthUserSession(user: AuthUser): void {
  const session = getAuthSession();

  if (!session) {
    return;
  }

  saveAuthSession({
    ...session,
    user: {
      ...session.user,
      ...user,
      role: session.user.role,
    },
  });
}

function mergeAuthAccountSession(account: AuthAccount): void {
  const session = getAuthSession();

  if (!session) {
    return;
  }

  saveAuthSession({
    ...session,
    account: {
      ...session.account,
      ...account,
    },
  });
}
