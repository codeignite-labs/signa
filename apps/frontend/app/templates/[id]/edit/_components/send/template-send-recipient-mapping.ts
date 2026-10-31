import type { CreateSubmissionSubmitterInput } from "@/lib/api/submissions";
import type { TemplateResponse } from "@/lib/api/templates";
import type {
  BulkRecipientRow,
  RecipientSet,
  SendRecipientTab,
  TemplateSendRole,
} from "./template-send-recipient-types";

const defaultRequestEmailSubject = "You are invited to sign a document";

export function getTemplateSendRoles(
  template: TemplateResponse,
): TemplateSendRole[] {
  const submitters = template.submitters.length
    ? template.submitters
    : [{ name: "First Party", uuid: "first-party" }];

  return submitters
    .map((submitter, index) => ({
      id: submitter.uuid || `role-${index}`,
      name: submitter.name?.trim() || `Party ${index + 1}`,
    }))
    .filter(
      (role, index, roles) =>
        roles.findIndex((candidate) => candidate.name === role.name) === index,
    );
}

export function createRecipientSet(
  roles: TemplateSendRole[],
  id: string,
): RecipientSet {
  return {
    contacts: Object.fromEntries(
      roles.map((role) => [
        role.id,
        {
          email: "",
          name: "",
          phone: "",
        },
      ]),
    ),
    id,
  };
}

export function buildSubmissionSubmitters(input: {
  activeTab: SendRecipientTab;
  recipientSet: RecipientSet;
  roles: TemplateSendRole[];
}): CreateSubmissionSubmitterInput[] {
  return input.roles.map((role) => {
    const contact = input.recipientSet.contacts[role.id];
    const fallbackName = contact.name.trim();

    return {
      email:
        input.activeTab !== "phone"
          ? contact.email.trim() || undefined
          : undefined,
      name: fallbackName || contact.email.trim() || contact.phone.trim(),
      phone:
        input.activeTab !== "email"
          ? contact.phone.trim() || undefined
          : undefined,
      role: role.name,
      send_email: input.activeTab !== "phone",
      send_sms: input.activeTab !== "email",
    };
  });
}

export function validateRecipientSets(input: {
  activeTab: SendRecipientTab;
  recipientSets: RecipientSet[];
  roles: TemplateSendRole[];
}): string | null {
  if (!input.recipientSets.length) {
    return "Add at least one recipient group.";
  }

  for (const [groupIndex, recipientSet] of input.recipientSets.entries()) {
    const error = validateRecipientSet({
      activeTab: input.activeTab,
      groupIndex,
      recipientSet,
      roles: input.roles,
    });

    if (error) return error;
  }

  return null;
}

export function shouldSendEmail(
  activeTab: SendRecipientTab,
  sendEmail: boolean,
): boolean {
  return activeTab !== "phone" && sendEmail;
}

export function shouldSendSms(
  activeTab: SendRecipientTab,
  sendSms: boolean,
): boolean {
  return activeTab === "phone" || (activeTab !== "email" && sendSms);
}

export function getRequestEmailSubject(template: TemplateResponse): string {
  const value = template.preferences.request_email_subject;

  return typeof value === "string" && value.trim()
    ? value
    : defaultRequestEmailSubject;
}

export function getRequestEmailBody(template: TemplateResponse): string {
  const value = template.preferences.request_email_body;

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return `Hi there,

You have been invited to sign the "{template.name}".

Review and Sign

Please contact us by replying to this email if you have any questions.

Thanks,
{account.name}`.replace("{template.name}", template.name);
}

export function buildSampleRecipientsCsv(roles: TemplateSendRole[]): string {
  const headers = roles.flatMap((role) => [
    `${role.name} Name`,
    `${role.name} Email`,
    `${role.name} Phone`,
  ]);
  const sampleValues = roles.flatMap((role, index) => [
    `${role.name} Recipient`,
    `recipient${index + 1}@example.com`,
    `+1555010${index.toString().padStart(2, "0")}`,
  ]);

  return `${headers.join(",")}\n${sampleValues.join(",")}\n`;
}

export function normalizeSheetRecipientRows(
  rows: unknown[][],
): BulkRecipientRow[] {
  const [headerRow, ...dataRows] = rows;

  if (!headerRow?.length) {
    return [];
  }

  const headers = headerRow.map((cell) => String(cell ?? "").trim());

  return dataRows
    .map((row) => mapSheetRowToRecipientRow(row, headers))
    .filter(hasAnyRecipientCell);
}

export function parseBulkRecipientRows(
  rows: BulkRecipientRow[],
  roles: TemplateSendRole[],
): RecipientSet[] {
  return rows
    .map((row, index) => parseBulkRecipientRow(row, roles, index))
    .filter((set) => hasAnyRecipientContact(set, roles));
}

function validateRecipientSet(input: {
  activeTab: SendRecipientTab;
  groupIndex: number;
  recipientSet: RecipientSet;
  roles: TemplateSendRole[];
}): string | null {
  for (const role of input.roles) {
    const contact = input.recipientSet.contacts[role.id];
    const label = `${role.name} in group ${input.groupIndex + 1}`;
    const error = validateContact(contact, label, input.activeTab);

    if (error) return error;
  }

  return null;
}

function validateContact(
  contact: { email: string; name: string; phone: string },
  label: string,
  activeTab: SendRecipientTab,
): string | null {
  if (activeTab === "email" && !contact.email.trim()) {
    return `${label} needs an email address.`;
  }

  if (activeTab === "phone" && !contact.phone.trim()) {
    return `${label} needs a phone number.`;
  }

  if (activeTab !== "detailed" && activeTab !== "upload") {
    return null;
  }

  if (!contact.name.trim()) {
    return `${label} needs a name.`;
  }

  if (!contact.email.trim() && !contact.phone.trim()) {
    return `${label} needs an email address or phone number.`;
  }

  return null;
}

function mapSheetRowToRecipientRow(
  row: unknown[],
  headers: string[],
): BulkRecipientRow {
  return Object.fromEntries(
    headers.map((header, index) => [
      header,
      row[index] === undefined || row[index] === null
        ? undefined
        : String(row[index]).trim(),
    ]),
  );
}

function hasAnyRecipientCell(row: BulkRecipientRow): boolean {
  return Object.values(row).some(
    (value) => typeof value === "string" && value.length > 0,
  );
}

function parseBulkRecipientRow(
  row: BulkRecipientRow,
  roles: TemplateSendRole[],
  rowIndex: number,
): RecipientSet {
  const values = new Map(normalizeBulkEntries(row));
  const recipientSet = createRecipientSet(roles, `bulk-row-${rowIndex + 1}`);

  roles.forEach((role, index) => {
    recipientSet.contacts[role.id] = mapRoleBulkContact(values, role, {
      index,
      allowUnprefixed: roles.length === 1,
    });
  });

  return recipientSet;
}

function normalizeBulkEntries(row: BulkRecipientRow): Array<[string, string]> {
  return Object.entries(row).map(([key, value]) => [
    normalizeRecipientColumnKey(key),
    value?.trim() ?? "",
  ]);
}

function mapRoleBulkContact(
  values: Map<string, string>,
  role: TemplateSendRole,
  context: { index: number; allowUnprefixed: boolean },
) {
  const { index, allowUnprefixed } = context;
  const roleKey = normalizeRecipientColumnKey(role.name);
  const ordinalKey = `party${index + 1}`;

  return {
    email:
      values.get(`${roleKey}email`) ??
      values.get(`${ordinalKey}email`) ??
      values.get(`email${index + 1}`) ??
      (allowUnprefixed ? values.get("email") : undefined) ??
      "",
    name:
      values.get(`${roleKey}name`) ??
      values.get(`${ordinalKey}name`) ??
      values.get(`name${index + 1}`) ??
      (allowUnprefixed ? values.get("name") : undefined) ??
      "",
    phone:
      values.get(`${roleKey}phone`) ??
      values.get(`${ordinalKey}phone`) ??
      values.get(`phone${index + 1}`) ??
      (allowUnprefixed ? values.get("phone") : undefined) ??
      "",
  };
}

function hasAnyRecipientContact(
  recipientSet: RecipientSet,
  roles: TemplateSendRole[],
): boolean {
  return roles.some((role) => {
    const contact = recipientSet.contacts[role.id];

    return contact.name || contact.email || contact.phone;
  });
}

function normalizeRecipientColumnKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
