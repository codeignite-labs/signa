import type { Metadata } from "next"
import { AuthShell } from "../_components/auth-shell"

export const metadata: Metadata = { referrer: "no-referrer" }

export default function ResetPasswordPage() {
  return <AuthShell mode="reset-password" />
}
