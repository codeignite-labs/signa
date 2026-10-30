import "./browser-settings-fixture";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { UsersImportDialog } from "../../../apps/frontend/app/settings/_components/users-import-dialog";
import { importUsers } from "../../../apps/frontend/lib/api/auth";
type CsvOptions = {
  complete: (result: { data: Record<string, string>[] }) => void;
  error: (error: Error) => void;
};
const state = vi.hoisted(() => ({
  csv: vi.fn<(file: File, options: CsvOptions) => void>(),
  sheet: vi.fn<() => Promise<unknown[][]>>(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("papaparse", () => ({ default: { parse: state.csv } }));
vi.mock("read-excel-file/browser", () => ({ readSheet: state.sheet }));
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  importUsers: vi.fn(),
}));
let imported: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  state.csv.mockReset();
  state.sheet.mockReset();
  imported = vi.fn<() => void>();
  vi.mocked(importUsers).mockResolvedValue({
    created: 1,
    restored: 0,
    skipped: 0,
    failed: 0,
    total: 1,
    results: [],
  });
});
function openImport() {
  render(<UsersImportDialog onImported={imported} />);
  fireEvent.click(screen.getByRole("button", { name: "Import Users" }));
}
function csvInput() {
  return document.querySelector<HTMLInputElement>(
    'input[accept=".csv,text/csv"]',
  )!;
}
function excelInput() {
  return document.querySelector<HTMLInputElement>('input[accept^=".xlsx"]')!;
}
it("shows a useful sample download and blocks an empty import", () => {
  openImport();
  expect(
    screen
      .getByRole("button", { name: "IMPORT USERS" })
      .hasAttribute("disabled"),
  ).toBe(true);
  const sample = screen.getByRole("link", { name: "Download sample CSV" });
  expect(sample.getAttribute("download")).toBe("signa-users-import-sample.csv");
  expect(decodeURIComponent(sample.getAttribute("href")!)).toContain(
    "email,first_name,last_name,role,team",
  );
});
it("normalizes pasted addresses, discards invalid emails and imports only the previewed rows", async () => {
  openImport();
  fireEvent.change(
    screen.getByPlaceholderText("ada@example.com, grace@example.com"),
    {
      target: {
        value: "ADA@EXAMPLE.TEST; invalid\n grace@example.test, bad@localhost",
      },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview emails" }));
  expect(
    screen.getByText("ada@example.test", { selector: "span" }),
  ).toBeTruthy();
  expect(screen.getByText("grace@example.test")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "IMPORT USERS" }));
  await waitFor(() => expect(imported).toHaveBeenCalledTimes(1));
  expect(importUsers).toHaveBeenCalledWith([
    { email: "ada@example.test", role: "member" },
    { email: "grace@example.test", role: "member" },
  ]);
  expect(toast.success).toHaveBeenCalledWith("Users import finished", {
    description: "1 created, 0 restored, 0 skipped, 0 failed.",
  });
});
it("limits long previews to 20 rows while importing the entire validated list", async () => {
  openImport();
  fireEvent.change(
    screen.getByPlaceholderText("ada@example.com, grace@example.com"),
    {
      target: {
        value: Array.from(
          { length: 21 },
          (_, n) => `person${n}@example.test`,
        ).join(","),
      },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview emails" }));
  expect(screen.getByText("Showing first 20 of 21 valid rows.")).toBeTruthy();
  expect(screen.queryByText("person20@example.test")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "IMPORT USERS" }));
  await waitFor(() =>
    expect(importUsers).toHaveBeenCalledWith(
      expect.arrayContaining([
        { email: "person20@example.test", role: "member" },
      ]),
    ),
  );
});
it.each([new Error("Bulk import blocked"), null])(
  "retains the parsed rows after import failure %s",
  async (failure) => {
    vi.mocked(importUsers).mockRejectedValue(failure);
    openImport();
    fireEvent.change(
      screen.getByPlaceholderText("ada@example.com, grace@example.com"),
      { target: { value: "ada@example.test" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview emails" }));
    fireEvent.click(screen.getByRole("button", { name: "IMPORT USERS" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Users could not be imported",
        expect.objectContaining({
          description:
            failure instanceof Error ? failure.message : "Please try again.",
        }),
      ),
    );
    expect(
      screen.getByText("ada@example.test", { selector: "span" }),
    ).toBeTruthy();
    expect(imported).not.toHaveBeenCalled();
  },
);
it("normalizes CSV snake/camel case names, roles, optional teams and invalid rows", async () => {
  state.csv.mockImplementation((_file, options) =>
    options.complete({
      data: [
        {
          email: " ADA@EXAMPLE.TEST ",
          first_name: " Ada ",
          last_name: " Lovelace ",
          role: " ADMIN ",
          team: " Legal ",
        },
        {
          email: "grace@example.test",
          firstName: " Grace ",
          lastName: " Hopper ",
          role: "unknown",
        },
        { email: "invalid" },
        {},
      ],
    }),
  );
  openImport();
  fireEvent.change(csvInput(), {
    target: { files: [new File(["csv"], "users.csv")] },
  });
  expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  expect(screen.getByText("Grace Hopper")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "IMPORT USERS" }));
  await waitFor(() =>
    expect(importUsers).toHaveBeenCalledWith([
      {
        email: "ada@example.test",
        first_name: "Ada",
        last_name: "Lovelace",
        role: "admin",
        team: "Legal",
      },
      {
        email: "grace@example.test",
        first_name: "Grace",
        last_name: "Hopper",
        role: "member",
        team: undefined,
      },
    ]),
  );
});
it("ignores canceled CSV selections and displays parser failures", () => {
  openImport();
  fireEvent.change(csvInput(), { target: { files: [] } });
  expect(state.csv).not.toHaveBeenCalled();
  state.csv.mockImplementation((_file, options) =>
    options.error(new Error("Malformed CSV")),
  );
  fireEvent.change(csvInput(), {
    target: { files: [new File(["bad"], "bad.csv")] },
  });
  expect(toast.error).toHaveBeenCalledWith("CSV could not be parsed", {
    description: "Malformed CSV",
  });
});
it("normalizes spreadsheet headers and cells then imports validated rows", async () => {
  state.sheet.mockResolvedValue([
    [" Email ", "First Name", "Last Name", "Role", "Team"],
    [" ADA@EXAMPLE.TEST ", " Ada ", " Lovelace ", "EDITOR", "Legal"],
    ["invalid", null],
    ["grace@example.test", "Grace", null, null, null],
  ]);
  openImport();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Excel" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.change(excelInput(), {
    target: { files: [new File(["xlsx"], "users.xlsx")] },
  });
  await screen.findByText("Ada Lovelace");
  fireEvent.click(screen.getByRole("button", { name: "IMPORT USERS" }));
  await waitFor(() =>
    expect(importUsers).toHaveBeenCalledWith([
      {
        email: "ada@example.test",
        first_name: "Ada",
        last_name: "Lovelace",
        role: "editor",
        team: "Legal",
      },
      {
        email: "grace@example.test",
        first_name: "Grace",
        last_name: undefined,
        role: "member",
        team: undefined,
      },
    ]),
  );
});
it("handles an empty spreadsheet and ignores canceled workbook selections", async () => {
  state.sheet.mockResolvedValue([]);
  openImport();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Excel" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.change(excelInput(), { target: { files: [] } });
  expect(state.sheet).not.toHaveBeenCalled();
  fireEvent.change(excelInput(), {
    target: { files: [new File(["xlsx"], "empty.xlsx")] },
  });
  await waitFor(() => expect(state.sheet).toHaveBeenCalledTimes(1));
  expect(screen.getByText("No valid users parsed yet.")).toBeTruthy();
});
it.each([new Error("Invalid workbook"), "failure"])(
  "displays spreadsheet parsing failure %s",
  async (failure) => {
    state.sheet.mockRejectedValue(failure);
    openImport();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Excel" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.change(excelInput(), {
      target: { files: [new File(["xlsx"], "bad.xlsx")] },
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Excel file could not be parsed",
        {
          description:
            failure instanceof Error ? failure.message : "Use an .xlsx file.",
        },
      ),
    );
  },
);
