import "./browser-settings-fixture";
import { beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { WebhooksSettingsBody } from "../../../apps/frontend/app/settings/_components/webhooks-settings-body";
import * as api from "../../../apps/frontend/lib/api/webhooks";
const state = vi.hoisted(() => ({
  isPending: false,
  isTestMode: false,
  setTestMode: vi.fn(),
  realtime: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "../../../apps/frontend/app/settings/_components/settings-sidebar",
  () => ({ SettingsSidebar: () => null }),
);
vi.mock("../../../apps/frontend/lib/hooks/use-test-mode", () => ({
  useTestMode: () => state,
}));
vi.mock("../../../apps/frontend/lib/realtime/use-realtime-events", () => ({
  useRealtimeEvents: state.realtime,
}));
vi.mock("../../../apps/frontend/lib/api/webhooks", async (original) => ({
  ...(await original<
    typeof import("../../../apps/frontend/lib/api/webhooks")
  >()),
  listWebhooks: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  testWebhook: vi.fn(),
  listWebhookEvents: vi.fn(),
  resendWebhookEvent: vi.fn(),
}));
const webhook: api.WebhookUrl = {
  id: "hook-1",
  url: "https://hooks.example.test/delivery",
  events: ["form.completed"],
  hmac_secret: "whsec_test",
  secret: {},
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};
const event: api.WebhookEvent = {
  id: "event-1",
  uuid: "uuid-1",
  event_type: "form.completed",
  record_type: "form",
  record_id: "record-1",
  status: "error",
  payload: { name: "Example" },
  created_at: "2026-01-01",
  attempts: [
    {
      id: "attempt-1",
      attempt: 1,
      response_status_code: 500,
      response_body: "Endpoint unavailable",
      created_at: "2026-01-01",
    },
  ],
};
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.isPending = false;
  state.isTestMode = false;
  vi.mocked(api.listWebhooks).mockResolvedValue({ data: [webhook] });
  vi.mocked(api.listWebhookEvents).mockResolvedValue({ data: [] });
  vi.mocked(api.createWebhook).mockImplementation(async (input) => ({
    ...webhook,
    ...input,
    id: "new-hook",
  }));
  vi.mocked(api.updateWebhook).mockImplementation(async (_id, input) => ({
    ...webhook,
    ...input,
  }));
  vi.mocked(api.deleteWebhook).mockResolvedValue(webhook);
  vi.mocked(api.testWebhook).mockResolvedValue({ queued: true });
  vi.mocked(api.resendWebhookEvent).mockResolvedValue({ queued: true });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
function renderWebhooks() {
  return render(
    <QueryClientProvider client={client}>
      <WebhooksSettingsBody />
    </QueryClientProvider>,
  );
}
async function loadWebhooks() {
  renderWebhooks();
  await screen.findByDisplayValue(webhook.url);
}
function changeUrl(value: string) {
  fireEvent.change(screen.getByLabelText("Webhook URL"), { target: { value } });
}
function save() {
  fireEvent.submit(screen.getByLabelText("Webhook URL").closest("form")!);
}
it("loads webhooks and events, reflects configured subscriptions, and integrates test-mode switching", async () => {
  await loadWebhooks();
  await screen.findByText("There are no events.");
  expect(
    screen
      .getByRole("checkbox", { name: "form.completed" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(
    screen
      .getByRole("checkbox", { name: "template.created" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("switch", { name: "Test mode" }));
  expect(state.setTestMode).toHaveBeenCalledWith(true);
  expect(state.realtime).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: "webhook",
      webhookUrlId: webhook.id,
      enabled: true,
    }),
  );
});
it("creates an initial webhook with default form subscriptions and updates the query cache", async () => {
  vi.mocked(api.listWebhooks).mockResolvedValue({ data: [] });
  renderWebhooks();
  await waitFor(() => expect(api.listWebhooks).toHaveBeenCalled());
  changeUrl("https://new.example.test");
  save();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Webhook saved"),
  );
  expect(api.createWebhook).toHaveBeenCalledWith({
    url: "https://new.example.test",
    events: ["form.viewed", "form.started", "form.completed", "form.declined"],
  });
  expect(screen.getByRole("button", { name: "Security" })).toBeTruthy();
});
it("starts a second webhook and adds/removes event subscriptions without changing the first webhook", async () => {
  await loadWebhooks();
  fireEvent.click(screen.getByRole("button", { name: "New Webhook" }));
  changeUrl("https://new.example.test");
  fireEvent.click(screen.getByRole("checkbox", { name: "form.viewed" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "template.created" }));
  save();
  await waitFor(() =>
    expect(api.createWebhook).toHaveBeenCalledWith({
      url: "https://new.example.test",
      events: [
        "form.started",
        "form.completed",
        "form.declined",
        "template.created",
      ],
    }),
  );
  expect(api.updateWebhook).not.toHaveBeenCalled();
});
it("switches between multiple webhook hosts and tolerates invalid legacy endpoint strings", async () => {
  vi.mocked(api.listWebhooks).mockResolvedValue({
    data: [webhook, { ...webhook, id: "hook-2", url: "legacy-endpoint" }],
  });
  await loadWebhooks();
  fireEvent.click(screen.getByRole("button", { name: "legacy-endpoint" }));
  expect(screen.getByDisplayValue("legacy-endpoint")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "hooks.example.test" }));
  expect(screen.getByDisplayValue(webhook.url)).toBeTruthy();
});
it("skips unchanged saves and patches only changed URL or event subscriptions", async () => {
  await loadWebhooks();
  save();
  expect(api.updateWebhook).not.toHaveBeenCalled();
  changeUrl("https://updated.example.test");
  save();
  await waitFor(() =>
    expect(api.updateWebhook).toHaveBeenCalledWith(webhook.id, {
      url: "https://updated.example.test",
    }),
  );
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Webhook saved"),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "template.created" }));
  save();
  await waitFor(() =>
    expect(api.updateWebhook).toHaveBeenLastCalledWith(webhook.id, {
      events: ["form.completed", "template.created"],
    }),
  );
});
it.each([new Error("URL blocked"), false])(
  "reports webhook save errors %s and preserves input",
  async (failure) => {
    vi.mocked(api.updateWebhook).mockRejectedValue(failure);
    await loadWebhooks();
    changeUrl("https://blocked.example.test");
    save();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Webhook could not be saved", {
        description:
          failure instanceof Error ? failure.message : "Please try again.",
      }),
    );
    expect(
      screen.getByDisplayValue("https://blocked.example.test"),
    ).toBeTruthy();
  },
);
it("reveals and copies the HMAC secret in the security dialog", async () => {
  await loadWebhooks();
  fireEvent.click(screen.getByRole("button", { name: "Security" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByDisplayValue("whsec_test")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Webhook secret copied"),
  );
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("whsec_test");
});
it("queues tests through both actions and copies the documented example", async () => {
  await loadWebhooks();
  fireEvent.click(screen.getByRole("button", { name: "Test" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Test webhook queued"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Test Webhook" }));
  expect(api.testWebhook).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Webhook example copied"),
  );
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    expect.stringContaining("form.completed"),
  );
});
it("reports test delivery errors", async () => {
  vi.mocked(api.testWebhook).mockRejectedValue(new Error("No completed forms"));
  await loadWebhooks();
  fireEvent.click(screen.getByRole("button", { name: "Test" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Test webhook could not be queued",
      { description: "No completed forms" },
    ),
  );
});
it("deletes a webhook only after the API succeeds and falls back to a fresh form", async () => {
  await loadWebhooks();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Webhook deleted"),
  );
  expect(api.deleteWebhook).toHaveBeenCalledWith(webhook.id);
  expect((screen.getByLabelText("Webhook URL") as HTMLInputElement).value).toBe(
    "",
  );
  expect(screen.queryByRole("button", { name: "Security" })).toBeNull();
});
it("reports webhook deletion errors without discarding the selected endpoint", async () => {
  vi.mocked(api.deleteWebhook).mockRejectedValue(new Error("Delete denied"));
  await loadWebhooks();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Webhook could not be deleted", {
      description: "Delete denied",
    }),
  );
  expect(screen.getByDisplayValue(webhook.url)).toBeTruthy();
});
it("displays delivery failures and opens details with attempt response bodies and payload copying", async () => {
  vi.mocked(api.listWebhookEvents).mockResolvedValue({ data: [event] });
  await loadWebhooks();
  await screen.findByText("Last attempt: HTTP 500 · Endpoint unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Attempt 1")).toBeTruthy();
  expect(within(dialog).getByText("Endpoint unavailable")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Webhook payload copied"),
  );
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    JSON.stringify(event.payload, null, 2),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Resend" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Webhook resend queued"),
  );
  expect(api.resendWebhookEvent).toHaveBeenCalledWith(event.id);
});
it("handles events without payloads or attempts and reports resend failures", async () => {
  vi.mocked(api.listWebhookEvents).mockResolvedValue({
    data: [{ ...event, payload: null, attempts: [] }],
  });
  vi.mocked(api.resendWebhookEvent).mockRejectedValue("failure");
  await loadWebhooks();
  await screen.findByRole("button", { name: "Details" });
  fireEvent.click(screen.getByRole("button", { name: "Resend" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Webhook could not be resent", {
      description: "Please try again.",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(
    screen.getByText("No delivery attempt has been recorded yet."),
  ).toBeTruthy();
});
it("handles empty response bodies and filters delivery events by status", async () => {
  vi.mocked(api.listWebhookEvents).mockResolvedValue({
    data: [
      { ...event, attempts: [{ ...event.attempts[0], response_body: null }] },
    ],
  });
  await loadWebhooks();
  await screen.findByText("Last attempt: HTTP 500");
  for (const [label, status] of [
    ["succeeded", "success"],
    ["failed", "error"],
    ["pending", "pending"],
    ["all", undefined],
  ] as const) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() =>
      expect(api.listWebhookEvents).toHaveBeenCalledWith(webhook.id, status),
    );
  }
});
it("shows webhook and event lookup failures", async () => {
  vi.mocked(api.listWebhooks).mockRejectedValue(new Error("offline"));
  const view = renderWebhooks();
  await screen.findByText("Webhooks could not be loaded.");
  view.unmount();
  client.clear();
  vi.mocked(api.listWebhooks).mockResolvedValue({ data: [webhook] });
  vi.mocked(api.listWebhookEvents).mockRejectedValue(
    new Error("events offline"),
  );
  renderWebhooks();
  await screen.findByText("Webhook events could not be loaded.");
});
it("shows loading while delivery events are being fetched and invalidates their cache on realtime updates", async () => {
  vi.mocked(api.listWebhookEvents).mockReturnValue(new Promise(() => {}));
  await loadWebhooks();
  expect(screen.getByRole("status").textContent).toBe("Loading…");
  const handler = state.realtime.mock.calls.at(-1)![0] as {
    onEvent: () => void;
  };
  const invalidate = vi.spyOn(client, "invalidateQueries");
  act(() => handler.onEvent());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["webhooks"] });
});
it("updates a selected webhook without overwriting a second endpoint", async () => {
  vi.mocked(api.listWebhooks).mockResolvedValue({
    data: [
      webhook,
      {
        ...webhook,
        id: "other-hook",
        url: "https://other.example.test/webhook",
      },
    ],
  });
  await loadWebhooks();
  changeUrl("https://updated.example.test/webhook");
  save();
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Webhook saved"),
  );
  expect(
    client.getQueryData(["webhooks", "list", { isTestMode: false }]),
  ).toMatchObject({
    data: [
      expect.objectContaining({ url: "https://updated.example.test/webhook" }),
      expect.objectContaining({
        id: "other-hook",
        url: "https://other.example.test/webhook",
      }),
    ],
  });
});
