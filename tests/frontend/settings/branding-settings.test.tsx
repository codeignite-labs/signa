import "./browser-settings-fixture";
import { beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import type { AccountBranding } from "../../../packages/shared/src/branding";
import { useBrandingEditor } from "../../../apps/frontend/app/settings/_components/use-branding-editor";
import { AccountBrandingSettings } from "../../../apps/frontend/app/settings/_components/account-branding-settings";
import { AccountLogoSettings } from "../../../apps/frontend/app/settings/_components/account-logo-settings";
import { updateAccountBranding } from "../../../apps/frontend/lib/api/branding";
import {
  deleteAccountLogo,
  uploadAccountLogo,
} from "../../../apps/frontend/lib/api/auth";
const brandState = vi.hoisted(() => ({
  accountId: "1",
  query: {
    isError: false,
    data: undefined as AccountBranding | undefined,
    refetch: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "../../../apps/frontend/components/branding/account-branding-provider",
  () => ({
    useAccountBrandingQuery: () => brandState,
    useAccountBranding: () => brandState.query.data,
  }),
);
vi.mock("../../../apps/frontend/lib/api/branding", () => ({
  updateAccountBranding: vi.fn(),
}));
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  deleteAccountLogo: vi.fn(),
  uploadAccountLogo: vi.fn(),
}));
const branding: AccountBranding = {
  account_name: "Example Organization",
  primary_color: "#27639d",
  white_label: false,
  show_business_name: true,
  logo: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  brandState.query.isError = false;
  brandState.query.data = branding;
  brandState.query.refetch.mockResolvedValue({ data: branding });
  vi.mocked(updateAccountBranding).mockResolvedValue(branding);
  vi.mocked(uploadAccountLogo).mockResolvedValue({
    uuid: "logo",
    filename: "logo.png",
    content_type: "image/png",
    url: "/logo.png",
  });
});
it("normalizes color drafts and derives dirty, invalid and preview values without mutating saved branding", () => {
  const { result } = renderHook(() =>
    useBrandingEditor(branding, brandState.query.refetch),
  );
  expect(result.current.dirty).toBe(false);
  act(() => result.current.setColor(" #AbC "));
  expect(result.current.normalized).toBe("#aabbcc");
  expect(result.current.invalid).toBe(false);
  expect(result.current.dirty).toBe(true);
  act(() => result.current.setColor("red"));
  expect(result.current.invalid).toBe(true);
  act(() => {
    result.current.setColor("");
    result.current.setWhiteLabel(true);
    result.current.setShowBusinessName(false);
  });
  expect(result.current.preview).toMatchObject({
    primary_color: null,
    white_label: true,
    show_business_name: false,
  });
  expect(branding.primary_color).toBe("#27639d");
});
it("defaults a missing color/title preference and persists normalized values before refreshing branding", async () => {
  const { result } = renderHook(() =>
    useBrandingEditor(
      { ...branding, primary_color: null, show_business_name: undefined },
      brandState.query.refetch,
    ),
  );
  expect(result.current.color).toBe("");
  expect(result.current.showBusinessName).toBe(true);
  act(() => result.current.setColor("#ABC"));
  await act(() => result.current.save());
  expect(updateAccountBranding).toHaveBeenCalledWith({
    primary_color: "#aabbcc",
    white_label: false,
    show_business_name: true,
  });
  expect(brandState.query.refetch).toHaveBeenCalledTimes(1);
  expect(result.current.busy).toBe(false);
  expect(toast.success).toHaveBeenCalledWith("Account branding saved");
});
it.each([new Error("save denied"), "failure"])(
  "reports branding save failure %s and clears busy state",
  async (failure) => {
    vi.mocked(updateAccountBranding).mockRejectedValue(failure);
    const { result } = renderHook(() =>
      useBrandingEditor(branding, brandState.query.refetch),
    );
    await act(() => result.current.save());
    expect(toast.error).toHaveBeenCalledWith(
      failure instanceof Error
        ? failure.message
        : "Branding could not be saved",
    );
    expect(brandState.query.refetch).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  },
);
it("renders loading and error states and retries a failed branding query", async () => {
  brandState.query.data = undefined;
  const view = render(<AccountBrandingSettings />);
  expect(screen.getByText("Loading branding…")).toBeTruthy();
  brandState.query.isError = true;
  view.rerender(<AccountBrandingSettings />);
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(brandState.query.refetch).toHaveBeenCalledTimes(1);
});
it("disables unchanged/invalid branding submissions and saves color and display toggles with previews", async () => {
  render(<AccountBrandingSettings />);
  const save = screen.getByRole("button", { name: "Save branding" });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.submit(save.closest("form")!);
  expect(updateAccountBranding).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Primary color"), {
    target: { value: "bad" },
  });
  expect(screen.getByText("Enter a hex color such as #27639D.")).toBeTruthy();
  fireEvent.submit(save.closest("form")!);
  expect(updateAccountBranding).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Choose primary color"), {
    target: { value: "#112233" },
  });
  fireEvent.click(screen.getByRole("switch", { name: "Show business title" }));
  fireEvent.click(
    screen.getByRole("switch", { name: "White-label experience" }),
  );
  expect(screen.getByText("Light preview")).toBeTruthy();
  expect(screen.getByText("Dark preview")).toBeTruthy();
  fireEvent.click(save);
  await waitFor(() =>
    expect(updateAccountBranding).toHaveBeenCalledWith({
      primary_color: "#112233",
      white_label: true,
      show_business_name: false,
    }),
  );
});
it("resets a custom color back to the default palette", async () => {
  render(<AccountBrandingSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(
    (screen.getByLabelText("Primary color") as HTMLInputElement).value,
  ).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
  await waitFor(() =>
    expect(updateAccountBranding).toHaveBeenCalledWith(
      expect.objectContaining({ primary_color: null }),
    ),
  );
});
it("uploads a logo, refreshes branding and clears the file input to permit retrying the same image", async () => {
  render(
    <AccountLogoSettings
      branding={branding}
      refresh={brandState.query.refetch}
    />,
  );
  const file = new File(["image"], "logo.png", { type: "image/png" });
  const input = screen.getByLabelText("Account logo file");
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Account logo uploaded"),
  );
  expect(uploadAccountLogo).toHaveBeenCalledWith(file);
  expect((input as HTMLInputElement).value).toBe("");
  expect(brandState.query.refetch).toHaveBeenCalledTimes(1);
});
it("removes an existing logo and refreshes the organization identity", async () => {
  render(
    <AccountLogoSettings
      branding={{
        ...branding,
        logo: { url: "/logo.png", background: "transparent" },
      }}
      refresh={brandState.query.refetch}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove account logo" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Account logo removed"),
  );
  expect(deleteAccountLogo).toHaveBeenCalledTimes(1);
});
it("opens the logo file picker and ignores a canceled file selection", () => {
  render(
    <AccountLogoSettings
      branding={branding}
      refresh={brandState.query.refetch}
    />,
  );
  const input = screen.getByLabelText("Account logo file");
  const click = vi.spyOn(input, "click");
  fireEvent.click(screen.getByRole("button", { name: "Upload logo" }));
  expect(click).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { files: [] } });
  expect(uploadAccountLogo).not.toHaveBeenCalled();
});
it("rejects oversized logos without a network upload", () => {
  render(
    <AccountLogoSettings
      branding={branding}
      refresh={brandState.query.refetch}
    />,
  );
  const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "huge.png");
  fireEvent.change(screen.getByLabelText("Account logo file"), {
    target: { files: [file] },
  });
  expect(toast.error).toHaveBeenCalledWith("Choose a logo smaller than 2 MB");
  expect(uploadAccountLogo).not.toHaveBeenCalled();
});
it.each([new Error("unsupported image"), undefined])(
  "reports logo upload failure %s and permits retry",
  async (failure) => {
    vi.mocked(uploadAccountLogo).mockRejectedValue(failure);
    render(
      <AccountLogoSettings
        branding={branding}
        refresh={brandState.query.refetch}
      />,
    );
    fireEvent.change(screen.getByLabelText("Account logo file"), {
      target: { files: [new File(["image"], "logo.png")] },
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        failure instanceof Error
          ? failure.message
          : "Logo could not be updated",
      ),
    );
    expect(
      screen
        .getByRole("button", { name: "Upload logo" })
        .hasAttribute("disabled"),
    ).toBe(false);
  },
);
