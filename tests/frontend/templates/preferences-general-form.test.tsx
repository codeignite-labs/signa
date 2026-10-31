import "../settings/browser-settings-fixture";
import { expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TemplatePreferencesGeneralForm } from "../../../apps/frontend/app/templates/[id]/edit/template-preferences-general-form";
import { preferencesToFormState } from "../../../apps/frontend/app/templates/[id]/edit/template-preferences-mapping";
import type { PreferencesFormState } from "../../../apps/frontend/app/templates/[id]/edit/template-preferences-types";
function Harness({
  save,
  initial = {},
}: {
  save: (value: PreferencesFormState) => void;
  initial?: Partial<PreferencesFormState>;
}) {
  const [formState, setFormState] = useState(() => ({
    ...preferencesToFormState({}),
    ...initial,
  }));
  return (
    <TemplatePreferencesGeneralForm
      formState={formState}
      isSaving={false}
      onStateChange={setFormState}
      onSave={async () => save(formState)}
    />
  );
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
async function choose(index: number, name: string) {
  fireEvent.keyDown(screen.getAllByRole("combobox")[index], {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("option", { name }));
}
it("updates completion messaging, redirect, BCC and owner signing controls", async () => {
  const save = vi.fn();
  render(<Harness save={save} />);
  fireEvent.click(
    screen.getByText("Form preferences", { selector: "summary" }),
  );
  fill("Completed documents notification BCC address", "legal@example.test");
  fill("Redirect on completion URL", "https://example.test/thanks");
  fill("Completion message", "Signed successfully");
  fill("Owner role name", "Executive");
  fireEvent.click(screen.getByRole("switch", { name: "Email owner" }));
  fireEvent.click(
    screen.getByRole("switch", { name: "Require email 2FA to open" }),
  );
  fireEvent.click(
    screen.getByRole("switch", { name: "Require phone 2FA to open" }),
  );
  await choose(1, "Auto-sign owner role");
  fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      bccCompleted: "legal@example.test",
      completedRedirectUrl: "https://example.test/thanks",
      completedMessageBody: "Signed successfully",
      ownerAutoSignRole: "Executive",
      ownerAutoSignMode: "enabled",
      ownerAutoSignSendEmail: true,
      requireEmailTwoFactor: true,
      requirePhoneTwoFactor: true,
    }),
  );
});
it("adds and removes recipient contact fields without dropping other form settings", () => {
  const save = vi.fn();
  render(<Harness save={save} />);
  fireEvent.click(
    screen.getByText("Form preferences", { selector: "summary" }),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Email" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Name" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Phone" }));
  fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ linkFormFields: ["name", "phone"] }),
  );
});
it("supports a specific expiry date and clears it after choosing a relative duration", async () => {
  const save = vi.fn();
  render(<Harness save={save} initial={{ defaultExpireAtDuration: "" }} />);
  await choose(0, "Specified date");
  fill("Expiration date", "2026-12-01T12:30");
  fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      defaultExpireAtDuration: "specified_date",
      defaultExpireAt: "2026-12-01T12:30",
    }),
  );
  await choose(0, "1 day");
  fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      defaultExpireAtDuration: "one_day",
      defaultExpireAt: "",
    }),
  );
});
it("edits the signature request email using the actual markdown editor", async () => {
  const save = vi.fn();
  render(<Harness save={save} />);
  fill("Subject", "Custom request subject");
  fireEvent.input(await screen.findByLabelText("Body"), {
    target: { textContent: "Custom request body" },
  });
  await act(async () => {});
  fireEvent.click(screen.getByRole("switch", { name: "Send request email" }));
  fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      requestEmailSubject: "Custom request subject",
      requestEmailBody: "Custom request body",
      requestEmailEnabled: false,
    }),
  );
});
it.each([
  ["Documents copy email", "documentsCopyEmail", "Send documents copy email"],
  [
    "Completed notification email",
    "completedNotificationEmail",
    "Send completed notification email",
  ],
] as const)(
  "edits %s text and attachment delivery preferences",
  async (section, prefix, label) => {
    const save = vi.fn();
    render(<Harness save={save} />);
    fireEvent.click(screen.getByRole("button", { name: section }));
    fill("Subject", "Custom subject");
    fireEvent.input(await screen.findByLabelText("Body"), {
      target: { textContent: "Custom body" },
    });
    await act(async () => {});
    fireEvent.click(screen.getByRole("switch", { name: label }));
    fireEvent.click(
      screen.getByRole("switch", { name: "Attach completed documents" }),
    );
    fireEvent.click(screen.getByRole("switch", { name: "Attach audit log" }));
    if (prefix === "documentsCopyEmail") fill("Reply to", "reply@example.test");
    fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        [prefix + "Subject"]: "Custom subject",
        [prefix + "Body"]: "Custom body",
        [prefix + "Enabled"]: false,
        [prefix + "AttachDocuments"]: false,
        [prefix + "AttachAudit"]: false,
        ...(prefix === "documentsCopyEmail"
          ? { documentsCopyEmailReplyTo: "reply@example.test" }
          : {}),
      }),
    );
  },
);
it("prevents double submission while preferences are being saved", () => {
  render(
    <TemplatePreferencesGeneralForm
      formState={preferencesToFormState({})}
      isSaving
      onSave={vi.fn()}
      onStateChange={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "SAVE" }).hasAttribute("disabled"),
  ).toBe(true);
});
