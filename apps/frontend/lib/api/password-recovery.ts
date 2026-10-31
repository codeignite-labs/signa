import { apiFetch } from "./http";

type RecoveryResponse = { ok: true };

export function requestPasswordReset(email: string): Promise<RecoveryResponse> {
  return apiFetch("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(input: {
  token: string;
  password: string;
  password_confirmation: string;
}): Promise<RecoveryResponse> {
  return apiFetch("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
