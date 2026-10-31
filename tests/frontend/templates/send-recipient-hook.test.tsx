import { template } from "./dashboard-fixture";
import { expect, it, vi } from "vitest";
import type { FormEvent } from "react";
import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { useTemplateSendRecipients } from "../../../apps/frontend/app/templates/[id]/edit/_components/send/use-template-send-recipients";
import { createTemplateSubmission } from "../../../apps/frontend/lib/api/submissions";
import { updateTemplatePreferences } from "../../../apps/frontend/lib/api/templates";
const event = () =>
  ({ preventDefault: vi.fn() }) as unknown as FormEvent<HTMLFormElement>;
function setup(
  preferences: Record<string, unknown> = {},
  onSent: (() => void) | undefined = vi.fn(),
) {
  const onOpenChange = vi.fn();
  const hook = renderHook(() =>
    useTemplateSendRecipients({
      template: {
        ...template,
        preferences,
        submitters: [{ uuid: "role", name: "Signer" }],
      },
      onOpenChange,
      onSent,
    }),
  );
  return { ...hook, onOpenChange, onSent };
}
it("initializes one recipient group and preserves at least one group during removal", () => {
  const { result } = setup();
  expect(result.current.selectedSetCount).toBe(1);
  expect(decodeURIComponent(result.current.sampleHref)).toContain(
    "Signer Name,Signer Email,Signer Phone",
  );
  const first = result.current.recipientSets[0].id;
  act(() => result.current.removeRecipientSet(first));
  expect(result.current.recipientSets).toHaveLength(1);
  act(() => result.current.addRecipientSet());
  expect(result.current.recipientSets).toHaveLength(2);
  const second = result.current.recipientSets[1].id;
  act(() =>
    result.current.updateRecipientContact(second, "role", {
      email: "second@example.test",
    }),
  );
  expect(result.current.recipientSets[0].contacts.role.email).toBe("");
  expect(result.current.recipientSets[1].contacts.role.email).toBe(
    "second@example.test",
  );
  act(() => result.current.removeRecipientSet(first));
  expect(result.current.recipientSets[0].id).toBe(second);
});
it("rejects incomplete recipient sets before changing sending state or calling the API", async () => {
  const { result } = setup();
  await act(() => result.current.submitRecipients(event()));
  expect(toast.error).toHaveBeenCalledWith("Recipients are incomplete", {
    description: "Signer in group 1 needs an email address.",
  });
  expect(createTemplateSubmission).not.toHaveBeenCalled();
  expect(result.current.isSending).toBe(false);
});
it("creates email groups in preserved order and closes the dialog after success", async () => {
  const { result, onOpenChange, onSent } = setup();
  act(() =>
    result.current.updateRecipientContact(
      result.current.recipientSets[0].id,
      "role",
      { email: "signer@example.test", name: "Grace" },
    ),
  );
  await act(() => result.current.submitRecipients(event()));
  expect(createTemplateSubmission).toHaveBeenCalledWith(
    template.id,
    expect.objectContaining({
      auto_sign_owner: undefined,
      auto_sign_owner_role: undefined,
      submitters_order: "preserved",
      send_email: true,
      send_sms: false,
      submitters: [
        {
          email: "signer@example.test",
          name: "Grace",
          role: "Signer",
          phone: undefined,
          send_email: true,
          send_sms: false,
        },
      ],
    }),
  );
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(onSent).toHaveBeenCalledTimes(1);
  expect(toast.success).toHaveBeenCalledWith("Signature requests created", {
    description: "The recipients can now complete this document.",
  });
});
it("submits multiple detailed groups with random order and saved message defaults", async () => {
  const { result } = setup({
    auto_sign_owner_enabled: true,
    auto_sign_owner_role: " Owner ",
  });
  act(() => {
    result.current.setActiveTab("detailed");
    result.current.setPreserveOrder(false);
    result.current.setSendEmail(false);
    result.current.setSendSms(true);
    result.current.setSaveMessage(true);
    result.current.setMessageBody(" Body ");
    result.current.setMessageSubject(" Subject ");
    result.current.addRecipientSet();
  });
  act(() => {
    for (const group of result.current.recipientSets)
      result.current.updateRecipientContact(group.id, "role", {
        name: "Grace",
        phone: "+15551234567",
      });
  });
  await act(() => result.current.submitRecipients(event()));
  expect(updateTemplatePreferences).toHaveBeenCalledWith(template.id, {
    request_email_body: "Body",
    request_email_subject: "Subject",
  });
  expect(createTemplateSubmission).toHaveBeenCalledTimes(2);
  expect(createTemplateSubmission).toHaveBeenLastCalledWith(
    template.id,
    expect.objectContaining({
      auto_sign_owner: true,
      auto_sign_owner_role: "Owner",
      message: undefined,
      send_email: false,
      send_sms: true,
      submitters_order: "random",
    }),
  );
  expect(toast.success).toHaveBeenCalledWith("Signature requests created", {
    description: "2 recipient groups can now complete this document.",
  });
});
it("selects uploaded recipient groups and supports an absent onSent callback", async () => {
  const onOpenChange = vi.fn();
  const { result } = renderHook(() =>
    useTemplateSendRecipients({
      template: { ...template, submitters: [] },
      onOpenChange,
    }),
  );
  act(() => {
    result.current.setActiveTab("upload");
    result.current.setBulkFileName("recipients.csv");
    result.current.setBulkRecipientSets([
      {
        id: "bulk",
        contacts: {
          "first-party": {
            name: "Grace",
            email: "grace@example.test",
            phone: "",
          },
        },
      },
    ]);
    result.current.setIsMessageOpen(true);
  });
  expect(result.current.bulkFileName).toBe("recipients.csv");
  expect(result.current.bulkRecipientCount).toBe(1);
  expect(result.current.selectedSetCount).toBe(1);
  expect(result.current.isMessageOpen).toBe(true);
  await act(() => result.current.submitRecipients(event()));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
it("submits phone-only contacts with SMS while preserving default delivery choices", async () => {
  const { result } = setup({ auto_sign_owner_role: 5 });
  act(() => {
    result.current.setActiveTab("phone");
    result.current.updateRecipientContact(
      result.current.recipientSets[0].id,
      "role",
      { phone: "+15551234567" },
    );
  });
  await act(() => result.current.submitRecipients(event()));
  expect(createTemplateSubmission).toHaveBeenCalledWith(
    template.id,
    expect.objectContaining({
      message: undefined,
      send_email: false,
      send_sms: true,
      submitters: [
        {
          phone: "+15551234567",
          name: "+15551234567",
          role: "Signer",
          email: undefined,
          send_email: false,
          send_sms: true,
        },
      ],
    }),
  );
});
it.each([new Error("Request rejected"), null])(
  "retains groups and clears pending state after sending failure %s",
  async (failure) => {
    vi.mocked(createTemplateSubmission).mockRejectedValue(failure);
    const { result, onOpenChange } = setup();
    act(() =>
      result.current.updateRecipientContact(
        result.current.recipientSets[0].id,
        "role",
        { email: "signer@example.test" },
      ),
    );
    await act(() => result.current.submitRecipients(event()));
    expect(toast.error).toHaveBeenCalledWith("Recipients could not be added", {
      description:
        failure instanceof Error
          ? failure.message
          : "Please check the recipients and try again.",
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(result.current.isSending).toBe(false);
    expect(result.current.recipientSets).toHaveLength(1);
  },
);
