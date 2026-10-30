import { expect, it } from "vitest";
import type { TemplateResponse } from "../../../apps/frontend/lib/api/templates";
import * as recipients from "../../../apps/frontend/app/templates/[id]/edit/_components/send/template-send-recipient-mapping";
import * as preferences from "../../../apps/frontend/app/templates/[id]/edit/template-preferences-mapping";
const template = (value: Partial<TemplateResponse> = {}) =>
  ({
    name: "Contract",
    submitters: [],
    preferences: {},
    ...value,
  }) as TemplateResponse;
const roles = [
  { id: "one", name: "First Party" },
  { id: "two", name: "Reviewer" },
];
it("derives distinct named roles, supplying safe defaults for legacy templates", () => {
  expect(recipients.getTemplateSendRoles(template())).toEqual([
    { id: "first-party", name: "First Party" },
  ]);
  expect(
    recipients.getTemplateSendRoles(
      template({
        submitters: [
          { uuid: "one", name: " Reviewer " },
          { uuid: "two", name: "Reviewer" },
          { uuid: "", name: " " },
        ],
      }),
    ),
  ).toEqual([
    { id: "one", name: "Reviewer" },
    { id: "role-2", name: "Party 3" },
  ]);
});
it.each(["email", "phone", "detailed", "upload"] as const)(
  "validates %s contacts and maps only appropriate channels",
  (activeTab) => {
    const set = recipients.createRecipientSet(roles, "group");
    expect(
      recipients.validateRecipientSets({ activeTab, recipientSets: [], roles }),
    ).toBe("Add at least one recipient group.");
    expect(
      recipients.validateRecipientSets({
        activeTab,
        recipientSets: [set],
        roles,
      }),
    ).toContain("First Party in group 1 needs");
    for (const role of roles)
      set.contacts[role.id] = {
        name: " Person ",
        email: " person@example.test ",
        phone: " +15551234567 ",
      };
    expect(
      recipients.validateRecipientSets({
        activeTab,
        recipientSets: [set],
        roles,
      }),
    ).toBeNull();
    const submitters = recipients.buildSubmissionSubmitters({
      activeTab,
      recipientSet: set,
      roles,
    });
    expect(submitters[0]).toMatchObject({
      name: "Person",
      role: "First Party",
      send_email: activeTab !== "phone",
      send_sms: activeTab !== "email",
    });
    expect(submitters[0].email).toBe(
      activeTab === "phone" ? undefined : "person@example.test",
    );
    expect(submitters[0].phone).toBe(
      activeTab === "email" ? undefined : "+15551234567",
    );
    expect(recipients.shouldSendEmail(activeTab, true)).toBe(
      activeTab !== "phone",
    );
    expect(recipients.shouldSendEmail(activeTab, false)).toBe(false);
    expect(recipients.shouldSendSms(activeTab, false)).toBe(
      activeTab === "phone",
    );
    expect(recipients.shouldSendSms(activeTab, true)).toBe(
      activeTab !== "email",
    );
  },
);
it("validates detailed contact alternatives and uses name fallbacks without inventing contact information", () => {
  const set = recipients.createRecipientSet([roles[0]], "group");
  set.contacts.one = { name: "Name", email: "", phone: "" };
  expect(
    recipients.validateRecipientSets({
      activeTab: "detailed",
      recipientSets: [set],
      roles: [roles[0]],
    }),
  ).toContain("email address or phone number");
  set.contacts.one = { name: "", email: "person@example.test", phone: "" };
  expect(
    recipients.buildSubmissionSubmitters({
      activeTab: "email",
      recipientSet: set,
      roles: [roles[0]],
    })[0].name,
  ).toBe("person@example.test");
  set.contacts.one = { name: "", email: "", phone: "123" };
  expect(
    recipients.buildSubmissionSubmitters({
      activeTab: "phone",
      recipientSet: set,
      roles: [roles[0]],
    })[0].name,
  ).toBe("123");
  set.contacts.one = { name: "Name", email: "", phone: "123" };
  expect(
    recipients.validateRecipientSets({
      activeTab: "detailed",
      recipientSets: [set],
      roles: [roles[0]],
    }),
  ).toBeNull();
});
it("normalizes spreadsheet cells, skips empty rows and maps role/ordinal/numbered column aliases", () => {
  expect(recipients.normalizeSheetRecipientRows([])).toEqual([]);
  expect(recipients.normalizeSheetRecipientRows([[]])).toEqual([]);
  const rows = recipients.normalizeSheetRecipientRows([
    ["First Party Email", "First Party Name", "Reviewer Phone"],
    [" signer@example.test ", " Name ", 15551234567],
    [null, undefined, ""],
    ["", null, undefined],
  ]);
  expect(rows).toEqual([
    {
      "First Party Email": "signer@example.test",
      "First Party Name": "Name",
      "Reviewer Phone": "15551234567",
    },
  ]);
  expect(recipients.parseBulkRecipientRows(rows, roles)[0].contacts).toEqual({
    one: { email: "signer@example.test", name: "Name", phone: "" },
    two: { email: "", name: "", phone: "15551234567" },
  });
  expect(
    recipients.parseBulkRecipientRows(
      [
        {},
        {
          "Party 1 Email": "email@example.test",
          Name2: "Reviewer",
          Phone2: "123",
        },
      ],
      roles,
    ),
  ).toMatchObject([
    {
      id: "bulk-row-2",
      contacts: {
        one: { email: "email@example.test" },
        two: { name: "Reviewer", phone: "123" },
      },
    },
  ]);
  expect(
    recipients.parseBulkRecipientRows(
      [
        {
          Email1: "email@example.test",
          "Party 1 Name": "Name",
          "Party 1 Phone": "123",
          "Party 2 Email": "reviewer@example.test",
          "Reviewer Name": undefined,
        },
      ],
      roles,
    ),
  ).toMatchObject([
    {
      contacts: {
        one: { name: "Name", phone: "123" },
        two: { email: "reviewer@example.test" },
      },
    },
  ]);
  expect(recipients.buildSampleRecipientsCsv(roles)).toContain(
    "First Party Name,First Party Email,First Party Phone,Reviewer Name,Reviewer Email,Reviewer Phone\n",
  );
});
it("uses configured invitation copy or meaningful template-specific defaults", () => {
  expect(recipients.getRequestEmailSubject(template())).toBe(
    "You are invited to sign a document",
  );
  expect(recipients.getRequestEmailBody(template())).toContain('"Contract"');
  const customized = template({
    preferences: {
      request_email_subject: "Subject",
      request_email_body: "Body",
    },
  });
  expect(recipients.getRequestEmailSubject(customized)).toBe("Subject");
  expect(recipients.getRequestEmailBody(customized)).toBe("Body");
  expect(
    recipients.getRequestEmailSubject(
      template({ preferences: { request_email_subject: " " } }),
    ),
  ).toBe(preferences.defaultRequestEmailSubject);
});
it("roundtrips defaults without erasing explicit false preference settings", () => {
  const form = preferences.preferencesToFormState({});
  expect(form).toMatchObject({
    ownerAutoSignMode: "inherit",
    ownerAutoSignRole: "First Party",
    linkFormFields: ["email"],
    defaultExpireAtDuration: "none",
    requestEmailEnabled: true,
  });
  const saved = preferences.formStateToPreferences({
    ...form,
    requestEmailEnabled: false,
    documentsCopyEmailEnabled: false,
  });
  expect(saved).toMatchObject({
    request_email_enabled: false,
    documents_copy_email_enabled: false,
  });
  expect(saved).not.toHaveProperty("auto_sign_owner_enabled");
  expect(saved).not.toHaveProperty("default_expire_at");
  expect(form.completedNotificationEmailBody).toBe(
    preferences.defaultCompletedNotificationEmailBody,
  );
  expect(form.documentsCopyEmailSubject).toBe(
    preferences.defaultDocumentsCopyEmailSubject,
  );
});
it.each([true, false])(
  "preserves explicit owner signing and switches email/two-factor settings (%s)",
  (enabled) => {
    const form = preferences.preferencesToFormState({
      auto_sign_owner_enabled: enabled,
      auto_sign_owner_send_email: enabled,
      require_email_2fa: enabled,
      require_phone_2fa: enabled,
      completed_notification_email_attach_audit: enabled,
      completed_notification_email_attach_documents: enabled,
      completed_notification_email_enabled: enabled,
      documents_copy_email_attach_audit: enabled,
      documents_copy_email_attach_documents: enabled,
      documents_copy_email_enabled: enabled,
      request_email_enabled: enabled,
      link_form_fields: ["email", 3, "name"],
    });
    expect(form.ownerAutoSignMode).toBe(enabled ? "enabled" : "disabled");
    expect(form.linkFormFields).toEqual(["email", "name"]);
    expect(preferences.formStateToPreferences(form)).toMatchObject({
      auto_sign_owner_enabled: enabled,
      auto_sign_owner_send_email: enabled,
      require_email_2fa: enabled,
      require_phone_2fa: enabled,
      completed_notification_email_attach_audit: enabled,
      documents_copy_email_enabled: enabled,
    });
  },
);
it("normalizes malformed settings and roundtrips local expiry times without shifting the instant", () => {
  for (const value of [null, [], 3])
    expect(
      preferences.preferencesToFormState({
        completed_message: value,
        link_form_fields: value,
        request_email_subject: value,
        default_expire_at: value,
      }),
    ).toMatchObject({
      completedMessageBody: "",
      requestEmailSubject: preferences.defaultRequestEmailSubject,
      defaultExpireAt: "",
    });
  const instant = "2026-11-01T12:34:00.000Z";
  const form = preferences.preferencesToFormState({
    default_expire_at: instant,
    default_expire_at_duration: "specified_date",
    completed_message: { body: "Done" },
    request_email_body: "Custom",
  });
  expect(form.defaultExpireAt).toMatch(/^2026-11-01T\d\d:34$/);
  expect(preferences.formStateToPreferences(form)).toMatchObject({
    default_expire_at: instant,
    completed_message: { body: "Done" },
    request_email_body: "Custom",
  });
  const invalid = preferences.preferencesToFormState({
    default_expire_at: "invalid",
    default_expire_at_duration: "specified_date",
  });
  expect(preferences.formStateToPreferences(invalid).default_expire_at).toBe(
    "invalid",
  );
  expect(
    preferences.formStateToPreferences({
      ...form,
      defaultExpireAt: "",
      linkFormFields: [],
    }),
  ).not.toHaveProperty("default_expire_at");
});
