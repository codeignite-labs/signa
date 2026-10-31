import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import IntegrationCallbackPage from "../../../apps/frontend/app/settings/integrations/[provider]/callback/page";
import { completeAccountEmailIntegration } from "../../../apps/frontend/lib/api/auth";
const state = vi.hoisted(() => ({
  replace: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => state,
  useSearchParams: () => state.params,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  completeAccountEmailIntegration: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.params = new URLSearchParams("code=authorization&state=state-token");
  vi.mocked(completeAccountEmailIntegration).mockResolvedValue({
    provider: "gmail",
    name: "Gmail",
    connected: true,
    configured: true,
    connected_at: null,
    email: "sender@example.test",
  });
});
it("completes Gmail OAuth with code and state and returns to integrations", async () => {
  render(<IntegrationCallbackPage params={{ provider: "gmail" }} />);
  expect(screen.getByText("Completing integration...")).toBeTruthy();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Gmail connected"),
  );
  expect(completeAccountEmailIntegration).toHaveBeenCalledWith("gmail", {
    code: "authorization",
    state: "state-token",
  });
  expect(state.replace).toHaveBeenCalledWith("/settings/integrations");
});
it("does not complete removed or unknown providers", () => {
  render(<IntegrationCallbackPage params={{ provider: "microsoft" }} />);
  expect(completeAccountEmailIntegration).not.toHaveBeenCalled();
  expect(state.replace).not.toHaveBeenCalled();
});
it("reports provider errors and missing authorization codes without calling the backend", () => {
  state.params = new URLSearchParams("error=access_denied");
  const view = render(
    <IntegrationCallbackPage params={{ provider: "gmail" }} />,
  );
  expect(toast.error).toHaveBeenCalledWith("Integration was not connected", {
    description: "access_denied",
  });
  expect(completeAccountEmailIntegration).not.toHaveBeenCalled();
  view.unmount();
  state.params = new URLSearchParams();
  render(<IntegrationCallbackPage params={{ provider: "gmail" }} />);
  expect(toast.error).toHaveBeenCalledWith("Missing authorization code");
});
it.each([new Error("Invalid OAuth state"), null])(
  "reports callback failure %s and navigates back safely",
  async (failure) => {
    vi.mocked(completeAccountEmailIntegration).mockRejectedValue(failure);
    render(<IntegrationCallbackPage params={{ provider: "gmail" }} />);
    await screen.findByText("Integration could not be connected.");
    expect(toast.error).toHaveBeenCalledWith(
      "Integration could not be connected",
      {
        description:
          failure instanceof Error ? failure.message : "Please try again.",
      },
    );
    expect(state.replace).toHaveBeenCalledWith("/settings/integrations");
  },
);
