import { template } from "./dashboard-fixture";
import { beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { TemplateSendRecipientsDialog } from "../../../apps/frontend/app/templates/[id]/edit/_components/send/template-send-recipients-dialog";
import { createTemplateSubmission } from "../../../apps/frontend/lib/api/submissions";
import { updateTemplatePreferences } from "../../../apps/frontend/lib/api/templates";
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
beforeEach(() => {
  vi.mocked(createTemplateSubmission).mockResolvedValue([]);
  files.csv.mockReset();
  files.sheet.mockReset();
});
function openDialog(roles = [{ uuid: "first", name: "First Party" }]) {
  const closed = vi.fn(),
    sent = vi.fn();
  render(
    <TemplateSendRecipientsDialog
      template={{ ...template, submitters: roles }}
      open
      onOpenChange={closed}
      onSent={sent}
    />,
  );
  return { closed, sent };
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
it("requires a contact for every role and sends a complete multi-role group in random order when requested", async () => {
  const { sent } = openDialog([
    { uuid: "first", name: "Signer" },
    { uuid: "second", name: "Reviewer" },
  ]);
  submit();
  expect(toast.error).toHaveBeenCalledWith("Recipients are incomplete", {
    description: "Signer in group 1 needs an email address.",
  });
  const inputs = screen.getAllByPlaceholderText("Email");
  fireEvent.change(inputs[0], { target: { value: "signer@example.test" } });
  fireEvent.change(inputs[1], { target: { value: "reviewer@example.test" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Preserve order" }));
  submit();
  await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
  expect(createTemplateSubmission).toHaveBeenCalledWith(
    template.id,
    expect.objectContaining({
      submitters_order: "random",
      submitters: [
        expect.objectContaining({
          email: "signer@example.test",
          role: "Signer",
        }),
        expect.objectContaining({
          email: "reviewer@example.test",
          role: "Reviewer",
        }),
      ],
    }),
  );
});
it("adds and removes recipient groups while maintaining role contacts and a useful count", () => {
  openDialog();
  expect(screen.getByText("1 recipient group ready.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "ADD NEW" }));
  expect(screen.getByText("2 recipient groups ready.")).toBeTruthy();
  const inputs = screen.getAllByPlaceholderText("Email");
  fireEvent.change(inputs[1], { target: { value: "second@example.test" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
  expect((screen.getByPlaceholderText("Email") as HTMLInputElement).value).toBe(
    "second@example.test",
  );
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
});
it("sends phone contacts by SMS and prevents disabling required phone delivery", async () => {
  openDialog();
  tab("via Phone");
  fill("Phone", "+15551234567");
  fill("Name (optional)", "Grace");
  expect(
    screen.getByRole("checkbox", { name: "Send SMS" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText("Send signature requests via SMS")).toBeTruthy();
  submit();
  await waitFor(() =>
    expect(createTemplateSubmission).toHaveBeenCalledWith(
      template.id,
      expect.objectContaining({
        send_email: false,
        send_sms: true,
        submitters: [
          expect.objectContaining({ phone: "+15551234567", name: "Grace" }),
        ],
      }),
    ),
  );
});
it("sends detailed contacts with the chosen notification channels", async () => {
  openDialog();
  tab("Detailed");
  fill("Name", "Grace");
  fill("Email (optional)", "grace@example.test");
  fill("Phone (optional)", "+15551234567");
  fireEvent.click(screen.getByRole("checkbox", { name: "Send Email" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Send SMS" }));
  submit();
  await waitFor(() =>
    expect(createTemplateSubmission).toHaveBeenCalledWith(
      template.id,
      expect.objectContaining({
        send_email: false,
        send_sms: true,
        message: undefined,
      }),
    ),
  );
});
it("saves edited default messages before sending and hides message editing on the phone tab", async () => {
  openDialog();
  fill("Email", "signer@example.test");
  fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
  fireEvent.change(screen.getByLabelText("Subject"), {
    target: { value: "Please sign" },
  });
  fireEvent.input(await screen.findByLabelText("Body"), {
    target: { textContent: "Custom message" },
  });
  await act(async () => {});
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Save as default template message" }),
  );
  submit();
  await waitFor(() =>
    expect(updateTemplatePreferences).toHaveBeenCalledWith(template.id, {
      request_email_body: "Custom message",
      request_email_subject: "Please sign",
    }),
  );
});
it("retains open message state but conceals its content when switching to phone delivery", async () => {
  openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
  await screen.findByLabelText("Body");
  tab("via Phone");
  expect(screen.queryByLabelText("Subject")).toBeNull();
});
it("shows a clear prompt for an empty upload tab and a role-specific downloadable sample", () => {
  openDialog();
  tab("Upload List");
  expect(
    screen.getByText("Upload a CSV or XLSX file to create recipient groups."),
  ).toBeTruthy();
  const sample = screen.getByRole("link", { name: "Sample" });
  expect(decodeURIComponent(sample.getAttribute("href")!)).toContain(
    "First Party Name,First Party Email,First Party Phone",
  );
  submit();
  expect(toast.error).toHaveBeenCalledWith("Recipients are incomplete", {
    description: "Add at least one recipient group.",
  });
});
it("parses CSV groups and sends each fully populated imported group", async () => {
  files.csv.mockImplementation((_file, options) =>
    options.complete({
      data: [
        {
          "First Party Name": "Grace",
          "First Party Email": "grace@example.test",
        },
        { Name1: "Ada", Email1: "ada@example.test" },
      ],
    }),
  );
  openDialog();
  tab("Upload List");
  const input = document.querySelector<HTMLInputElement>(
    'input[accept=".csv,text/csv"]',
  )!;
  fireEvent.change(input, {
    target: { files: [new File(["csv"], "recipients.csv")] },
  });
  expect(
    screen.getByText("recipients.csv: 2 recipient groups parsed."),
  ).toBeTruthy();
  expect(input.value).toBe("");
  submit();
  await waitFor(() =>
    expect(createTemplateSubmission).toHaveBeenCalledTimes(2),
  );
});
it("parses a workbook and counts its imported recipient group", async () => {
  files.sheet.mockResolvedValue([
    ["Name", "Email"],
    ["Grace", "grace@example.test"],
  ]);
  openDialog();
  tab("Upload List");
  const input = document.querySelector<HTMLInputElement>(
    'input[accept^=".xlsx"]',
  )!;
  fireEvent.change(input, {
    target: { files: [new File(["xlsx"], "recipients.xlsx")] },
  });
  await screen.findByText("recipients.xlsx: 1 recipient group parsed.");
  expect(input.value).toBe("");
  submit();
  await waitFor(() =>
    expect(createTemplateSubmission).toHaveBeenCalledTimes(1),
  );
});
it("ignores canceled uploads and reports CSV parser errors without losing the dialog", () => {
  openDialog();
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
it.each([new Error("Workbook malformed"), null])(
  "reports workbook parse failure %s with a retryable input",
  async (failure) => {
    files.sheet.mockRejectedValue(failure);
    openDialog();
    tab("Upload List");
    fireEvent.change(
      document.querySelector<HTMLInputElement>('input[accept^=".xlsx"]')!,
      { target: { files: [new File(["bad"], "bad.xlsx")] } },
    );
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
  },
);
