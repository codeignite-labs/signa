import { expect, it } from "vitest";
import {
  normalizeSheetRecipientRows,
  parseBulkRecipientRows,
} from "../../../apps/frontend/app/templates/[id]/edit/_components/send/template-send-recipient-mapping";
const role = { id: "role", name: "First Party" };
it("accepts the generated single-role sample columns for both CSV and workbook rows", () => {
  const csv = [
    { Name: " Grace ", Email: " grace@example.test ", Phone: " +15551234567 " },
  ];
  const workbook = normalizeSheetRecipientRows([
    ["Name", "Email", "Phone"],
    ["Grace", "grace@example.test", "+15551234567"],
  ]);
  for (const rows of [csv, workbook])
    expect(parseBulkRecipientRows(rows, [role])[0].contacts[role.id]).toEqual({
      name: "Grace",
      email: "grace@example.test",
      phone: "+15551234567",
    });
});
it("preserves role-prefixed and numbered columns over unprefixed sample headers", () => {
  const row = {
    Name: "Fallback",
    Email: "fallback@example.test",
    Phone: "fallback",
    "First Party Name": "Preferred",
    Email1: "preferred@example.test",
    "Party 1 Phone": "123",
  };
  expect(parseBulkRecipientRows([row], [role])[0].contacts[role.id]).toEqual({
    name: "Preferred",
    email: "preferred@example.test",
    phone: "123",
  });
});
it("does not distribute ambiguous bare contact columns to multiple signer roles", () => {
  const rows = [{ Name: "Grace", Email: "grace@example.test", Phone: "123" }];
  expect(
    parseBulkRecipientRows(rows, [role, { id: "reviewer", name: "Reviewer" }]),
  ).toEqual([]);
  expect(parseBulkRecipientRows(rows, [])).toEqual([]);
});
it("ignores empty spreadsheet header cells while preserving recognized recipient columns", () => {
  const rows = normalizeSheetRecipientRows([
    [null, "Email", undefined],
    ["ignored", "grace@example.test", "ignored"],
  ]);
  expect(parseBulkRecipientRows(rows, [role])[0].contacts[role.id].email).toBe(
    "grace@example.test",
  );
});
