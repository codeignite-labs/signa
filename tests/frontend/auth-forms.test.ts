import { expect, it } from "vitest";
import {
  authFormSchema,
  loginFormSchema,
  registerFormSchema,
  forgotPasswordFormSchema,
  resetPasswordFormSchema,
  otpFormSchema,
} from "../../apps/frontend/lib/forms/auth-forms";

it.each([
  ["login", { email: "reader@example.test", password: "password" }],
  [
    "register",
    { email: "reader@example.test", password: "long-password", name: "Reader" },
  ],
  ["forgot-password", { email: "reader@example.test" }],
  [
    "reset-password",
    { password: "new-password", confirmPassword: "new-password" },
  ],
  ["otp", { otp: "123456" }],
])("accepts valid %s form input", (mode, input) => {
  expect(authFormSchema.safeParse({ mode, ...input }).success).toBe(true);
});
it.each([
  [{ mode: "login" }, ["email", "password"]],
  [
    { mode: "register", email: "bad", password: "short" },
    ["email", "name", "password"],
  ],
  [
    { mode: "register", email: "valid@example.test", name: "Reader" },
    ["password"],
  ],
  [{ mode: "forgot-password", email: "" }, ["email"]],
  [
    { mode: "reset-password", password: "short", confirmPassword: "other" },
    ["password", "confirmPassword"],
  ],
  [{ mode: "otp" }, ["otp"]],
  [{ mode: "otp", otp: "12345" }, ["otp"]],
])("reports actionable field errors: %j", (input, fields) => {
  const result = authFormSchema.safeParse(input);
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.error.issues.map((issue) => issue.path[0])).toEqual(fields);
});
it("enforces the individual form contracts and matching reset passwords", () => {
  expect(
    loginFormSchema.safeParse({ email: "bad", password: "" }).success,
  ).toBe(false);
  expect(
    registerFormSchema.safeParse({
      email: "valid@example.test",
      password: "1234567",
      name: "",
    }).success,
  ).toBe(false);
  expect(
    forgotPasswordFormSchema.safeParse({ email: "valid@example.test" }).success,
  ).toBe(true);
  expect(
    resetPasswordFormSchema.safeParse({
      password: "new-password",
      confirmPassword: "new-password",
    }).success,
  ).toBe(true);
  expect(
    resetPasswordFormSchema.safeParse({
      password: "new-password",
      confirmPassword: "different-password",
    }).success,
  ).toBe(false);
  expect(otpFormSchema.safeParse({ otp: "123456" }).success).toBe(true);
});
