import { ApiError } from "@/lib/api/http";
import {
  requestPasswordReset,
  resetPassword,
} from "@/lib/api/password-recovery";
import type { AuthFormValues } from "@/lib/forms/auth-forms";
import type { AuthMode } from "@/lib/i18n/auth-dictionaries";

type RecoveryResult = { title: string; message: string; redirect?: string };

export async function submitPasswordRecovery(
  mode: AuthMode,
  values: AuthFormValues,
): Promise<RecoveryResult> {
  if (mode === "forgot-password") {
    await requestPasswordReset(values.email ?? "");
    return {
      title: "Check your email",
      message:
        "If an active account uses that address, we'll email a password reset link.",
    };
  }
  if (mode === "reset-password") {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token)
      throw new ApiError(
        "Open the password reset link from your email to continue.",
        422,
      );
    await resetPassword({
      token,
      password: values.password ?? "",
      password_confirmation: values.confirmPassword ?? "",
    });
    return {
      title: "Password updated",
      message: "Sign in with your new password.",
      redirect: "/auth/login",
    };
  }
  throw new ApiError("Sign in again to verify a two-factor code.", 401);
}
