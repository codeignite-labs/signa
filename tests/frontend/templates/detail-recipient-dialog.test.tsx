import { loadDetail } from "./detail-fixture";
import { template } from "./dashboard-fixture";
import { expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import * as api from "../../../apps/frontend/lib/api/templates";
import * as submissions from "../../../apps/frontend/lib/api/submissions";
type CsvOptions = {
  complete: (result: { data: Record<string, string>[] }) => void;
  error: (error: Error) => void;
};
const files = vi.hoisted(() => ({
  csv: vi.fn<(file: File, options: CsvOptions) => void>(),
  sheet: vi.fn<() => Promise<unknown[][]>>(),
}));
vi.mock("papaparse", () => ({ default: { parse: files.csv } }));
vi.mock("read-excel-file/browser", () => ({ readSheet: files.sheet }));
async function openRecipients() {
  await loadDetail();
  fireEvent.click(screen.getByRole("button", { name: "ADD RECIPIENTS" }));
}
function tab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), {
    button: 0,
    ctrlKey: false,
  });
}
function fill(placeholder: string, value: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value },
  });
}
function submit() {
  fireEvent.submit(
    screen.getByRole("button", { name: "ADD RECIPIENTS" }).closest("form")!,
  );
}
it("rejects an empty recipient list before creating any submissions", async () => {
  await openRecipients();
  submit();
  expect(toast.error).toHaveBeenCalledWith("Add at least one recipient");
  expect(submissions.createTemplateSubmission).not.toHaveBeenCalled();
});
it("sends one signing request per email and refreshes detail after successful sending", async () => {
  await openRecipients();
  fill("Type emails here...", "first@example.test; second@example.test\n");
  submit();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Recipients added", {
      description: "2 recipients can now complete this document.",
    }),
  );
  expect(submissions.createTemplateSubmission).toHaveBeenCalledTimes(2);
  expect(submissions.createTemplateSubmission).toHaveBeenNthCalledWith(
    1,
    template.id,
    expect.objectContaining({
      auto_sign_owner: false,
      auto_sign_owner_role: "First Party",
      send_email: true,
      send_sms: false,
      submitters_order: "preserved",
      submitters: [
        {
          email: "first@example.test",
          name: "first@example.test",
          role: "First Party",
          send_email: true,
          send_sms: false,
        },
      ],
    }),
  );
  await waitFor(() => expect(api.getTemplate).toHaveBeenCalledTimes(2));
});
it("creates email signing requests without notification when Send Email is unchecked", async () => {
  await openRecipients();
  fill("Type emails here...", "first@example.test");
  fireEvent.click(screen.getByRole("checkbox", { name: "Send Email" }));
  submit();
  await waitFor(() =>
    expect(submissions.createTemplateSubmission).toHaveBeenCalledWith(
      template.id,
      expect.objectContaining({ send_email: false, message: undefined }),
    ),
  );
});
it.each([new Error("Recipient rejected"), null])(
  "reports request creation failure %s and preserves recipients for correction",
  async (failure) => {
    vi.mocked(submissions.createTemplateSubmission).mockRejectedValue(failure);
    await openRecipients();
    fill("Type emails here...", "first@example.test");
    submit();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Recipients could not be added",
        {
          description:
            failure instanceof Error
              ? failure.message
              : "Please check the recipients and try again.",
        },
      ),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  },
);
it("edits the request message and saves it as the default before creating the submission", async () => {
  await openRecipients();
  fill("Type emails here...", "first@example.test");
  fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
  fireEvent.change(screen.getByLabelText("Subject"), {
    target: { value: "  Please review  " },
  });
  fireEvent.input(await screen.findByLabelText("Body"), {
    target: { textContent: "Custom body" },
  });
  await act(async () => {});
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Save as default template message" }),
  );
  submit();
  await waitFor(() =>
    expect(api.updateTemplatePreferences).toHaveBeenCalledWith(template.id, {
      request_email_body: "Custom body",
      request_email_subject: "Please review",
    }),
  );
  expect(submissions.createTemplateSubmission).toHaveBeenCalledWith(
    template.id,
    expect.objectContaining({
      message: { body: "Custom body", subject: "Please review" },
    }),
  );
});
it("builds phone requests with SMS delivery and optional recipient names", async () => {
  await openRecipients();
  tab("via Phone");
  fill("Phone", " +15551234567 ");
  fill("Name (optional)", "  Grace  ");
  fireEvent.click(screen.getByRole("button", { name: "ADD NEW" }));
  const phones = screen.getAllByPlaceholderText("Phone");
  fireEvent.change(phones[1], { target: { value: "+15551234568" } });
  submit();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Recipients added", {
      description: "2 recipients can now complete this document.",
    }),
  );
  expect(submissions.createTemplateSubmission).toHaveBeenNthCalledWith(
    1,
    template.id,
    expect.objectContaining({
      send_email: false,
      send_sms: true,
      submitters: [
        {
          phone: "+15551234567",
          name: "Grace",
          role: "First Party",
          send_email: false,
          send_sms: true,
        },
      ],
    }),
  );
  expect(submissions.createTemplateSubmission).toHaveBeenNthCalledWith(
    2,
    template.id,
    expect.objectContaining({
      submitters: [
        {
          phone: "+15551234568",
          name: "+15551234568",
          role: "First Party",
          send_email: false,
          send_sms: true,
        },
      ],
    }),
  );
});
it("builds detailed recipients with both email and phone and ignores empty extra rows", async () => {
  await openRecipients();
  tab("Detailed");
  fill("Name", "  Grace  ");
  fill("Email (optional)", " grace@example.test ");
  fill("Phone (optional)", " +15551234567 ");
  fireEvent.click(screen.getByRole("button", { name: "ADD NEW" }));
  submit();
  await waitFor(() =>
    expect(submissions.createTemplateSubmission).toHaveBeenCalledWith(
      template.id,
      expect.objectContaining({
        submitters: [
          {
            email: "grace@example.test",
            phone: "+15551234567",
            name: "Grace",
            role: "First Party",
            send_email: true,
            send_sms: true,
          },
        ],
      }),
    ),
  );
  expect(submissions.createTemplateSubmission).toHaveBeenCalledTimes(1);
});
it("uses available contact values for a detailed recipient without a name", async () => {
  await openRecipients();
  tab("Detailed");
  fill("Phone (optional)", "+15551234567");
  submit();
  await waitFor(() =>
    expect(submissions.createTemplateSubmission).toHaveBeenCalledWith(
      template.id,
      expect.objectContaining({
        submitters: [
          {
            email: undefined,
            phone: "+15551234567",
            name: "+15551234567",
            role: "First Party",
            send_email: false,
            send_sms: true,
          },
        ],
      }),
    ),
  );
});
it("selects the external recipient role when auto-signing the owner and supports disabling auto-sign", async () => {
  vi.mocked(api.getTemplate).mockResolvedValue({
    ...template,
    submitters: [
      { uuid: "owner", name: "Owner" },
      { uuid: "recipient", name: "Customer" },
    ],
    preferences: {
      auto_sign_owner_enabled: true,
      auto_sign_owner_role: "Owner",
    },
  });
  await openRecipients();
  fill("Type emails here...", "customer@example.test");
  fireEvent.click(screen.getByRole("checkbox", { name: /Auto-sign Owner/ }));
  submit();
  await waitFor(() =>
    expect(submissions.createTemplateSubmission).toHaveBeenCalledWith(
      template.id,
      expect.objectContaining({
        auto_sign_owner: false,
        auto_sign_owner_role: "Owner",
        submitters: [expect.objectContaining({ role: "Owner" })],
      }),
    ),
  );
});
it("skips the configured owner role for the recipient when automatic owner signing stays enabled", async () => {
  vi.mocked(api.getTemplate).mockResolvedValue({
    ...template,
    submitters: [
      { uuid: "owner", name: "Owner" },
      { uuid: "recipient", name: "Customer" },
    ],
    preferences: {
      auto_sign_owner_enabled: true,
      auto_sign_owner_role: " Owner ",
    },
  });
  await openRecipients();
  fill("Type emails here...", "customer@example.test");
  submit();
  await waitFor(() =>
    expect(submissions.createTemplateSubmission).toHaveBeenCalledWith(
      template.id,
      expect.objectContaining({
        auto_sign_owner: true,
        submitters: [expect.objectContaining({ role: "Customer" })],
      }),
    ),
  );
});
it("uses the default First Party role for templates without submitter names and supports older browser UUID fallback", async () => {
  vi.mocked(api.getTemplate).mockResolvedValue({
    ...template,
    submitters: [],
    preferences: { auto_sign_owner_enabled: true, auto_sign_owner_role: 123 },
  });
  vi.stubGlobal("crypto", {});
  await openRecipients();
  fill("Type emails here...", "customer@example.test");
  submit();
  await waitFor(() =>
    expect(submissions.createTemplateSubmission).toHaveBeenCalledWith(
      template.id,
      expect.objectContaining({
        auto_sign_owner_role: "First Party",
        submitters: [expect.objectContaining({ role: "First Party" })],
      }),
    ),
  );
});
it("parses CSV recipient lists into role contacts and reports the file and parsed count", async () => {
  files.csv.mockImplementation((_file, options) =>
    options.complete({
      data: [
        {
          Name: " Grace ",
          Email: " grace@example.test ",
          Phone: " +15551234567 ",
        },
        { Email: "second@example.test" },
        {},
      ],
    }),
  );
  await openRecipients();
  tab("Upload List");
  const input = document.querySelector<HTMLInputElement>(
    'input[accept=".csv,text/csv"]',
  )!;
  fireEvent.change(input, {
    target: { files: [new File(["csv"], "recipients.csv")] },
  });
  expect(screen.getByText("recipients.csv: 2 recipients parsed.")).toBeTruthy();
  expect(input.value).toBe("");
  submit();
  await waitFor(() =>
    expect(submissions.createTemplateSubmission).toHaveBeenCalledTimes(2),
  );
});
it("parses an XLSX list and displays its singular recipient count", async () => {
  files.sheet.mockResolvedValue([
    ["Name", "Email", "Phone"],
    ["Grace", "grace@example.test", null],
  ]);
  await openRecipients();
  tab("Upload List");
  const input = document.querySelector<HTMLInputElement>(
    'input[accept^=".xlsx"]',
  )!;
  fireEvent.change(input, {
    target: { files: [new File(["xlsx"], "recipients.xlsx")] },
  });
  await screen.findByText("recipients.xlsx: 1 recipient parsed.");
  submit();
  await waitFor(() =>
    expect(submissions.createTemplateSubmission).toHaveBeenCalledWith(
      template.id,
      expect.objectContaining({
        submitters: [
          expect.objectContaining({
            email: "grace@example.test",
            name: "Grace",
          }),
        ],
      }),
    ),
  );
});
it("ignores canceled CSV and XLSX selections and surfaces CSV parse errors", async () => {
  files.csv.mockReset();
  files.sheet.mockReset();
  await openRecipients();
  tab("Upload List");
  const csv = document.querySelector<HTMLInputElement>(
      'input[accept=".csv,text/csv"]',
    )!,
    excel = document.querySelector<HTMLInputElement>('input[accept^=".xlsx"]')!;
  fireEvent.change(csv, { target: { files: [] } });
  fireEvent.change(excel, { target: { files: [] } });
  expect(files.csv).not.toHaveBeenCalled();
  expect(files.sheet).not.toHaveBeenCalled();
  files.csv.mockImplementation((_file, options) =>
    options.error(new Error("CSV malformed")),
  );
  fireEvent.change(csv, { target: { files: [new File(["bad"], "bad.csv")] } });
  expect(toast.error).toHaveBeenCalledWith("CSV file could not be parsed", {
    description: "CSV malformed",
  });
});
it.each([new Error("XLSX malformed"), false])(
  "surfaces workbook parse failure %s and resets the file input for retry",
  async (failure) => {
    files.sheet.mockRejectedValue(failure);
    await openRecipients();
    tab("Upload List");
    const input = document.querySelector<HTMLInputElement>(
      'input[accept^=".xlsx"]',
    )!;
    fireEvent.change(input, {
      target: { files: [new File(["bad"], "bad.xlsx")] },
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Excel file could not be parsed",
        {
          description:
            failure instanceof Error
              ? failure.message
              : "Use an .xlsx workbook.",
        },
      ),
    );
    expect(input.value).toBe("");
  },
);
