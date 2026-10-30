import "./form-upload-fixture";
import { expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CertificateUploadDialog } from "../../../apps/frontend/app/settings/_components/certificate-upload-dialog";
function fillCertificate(file: File, name = "  Organization  ") {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Certificate file"), {
    target: { files: [file] },
  });
}
function submit() {
  fireEvent.submit(
    screen.getByRole("button", { name: "Upload certificate" }).closest("form")!,
  );
}
it("uploads a named PFX identity and its password and closes only after validation succeeds", async () => {
  const upload = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  render(<CertificateUploadDialog onUpload={upload} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Upload signing identity" }),
  );
  const file = new File(["certificate"], "identity.pfx");
  fillCertificate(file);
  fireEvent.change(screen.getByLabelText("P12/PFX password"), {
    target: { value: " secret password " },
  });
  submit();
  await waitFor(() =>
    expect(upload).toHaveBeenCalledWith(
      file,
      "Organization",
      " secret password ",
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("accepts public CA uploads without a password field", async () => {
  const upload = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  render(<CertificateUploadDialog kind="trust" onUpload={upload} />);
  fireEvent.click(screen.getByRole("button", { name: "Upload trusted CA" }));
  expect(screen.queryByLabelText("P12/PFX password")).toBeNull();
  const file = new File(["public certificate"], "root.pem");
  fillCertificate(file);
  submit();
  await waitFor(() =>
    expect(upload).toHaveBeenCalledWith(file, "Organization", ""),
  );
});
it("does not upload a missing or empty file even if the form is submitted programmatically", () => {
  const upload = vi.fn<() => Promise<void>>();
  render(<CertificateUploadDialog onUpload={upload} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Upload signing identity" }),
  );
  submit();
  expect(upload).not.toHaveBeenCalled();
  fillCertificate(new File([], "empty.p12"));
  submit();
  expect(upload).not.toHaveBeenCalled();
});
it.each([new Error("Private key missing"), null])(
  "shows certificate upload failure %s and permits retry",
  async (failure) => {
    const upload = vi.fn<() => Promise<void>>().mockRejectedValue(failure);
    render(<CertificateUploadDialog onUpload={upload} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Upload signing identity" }),
    );
    fillCertificate(new File(["certificate"], "invalid.pfx"));
    submit();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        failure instanceof Error
          ? failure.message
          : "Certificate could not be uploaded",
      ),
    );
    expect(
      screen
        .getByRole("button", { name: "Upload certificate" })
        .hasAttribute("disabled"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);
it("keeps the dialog and fields locked while validation is pending and prevents escape dismissal", async () => {
  let finish!: () => void;
  const upload = vi.fn<() => Promise<void>>().mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<CertificateUploadDialog onUpload={upload} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Upload signing identity" }),
  );
  fillCertificate(new File(["certificate"], "identity.pfx"));
  submit();
  expect(
    screen
      .getByRole("button", { name: "Validating…" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByLabelText("Name").hasAttribute("disabled")).toBe(true);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
