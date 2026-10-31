import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const routing = vi.hoisted(() => ({ push: vi.fn() }));
const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => routing }));
vi.mock("sonner", () => ({ toast: notifications }));
import { SubmissionDetailPage } from "../../../apps/frontend/app/submissions/[id]/submission-detail-page";
import SubmissionRoute from "../../../apps/frontend/app/submissions/[id]/page";
import { saveAuthSession } from "../../../apps/frontend/lib/api/auth";
import { submission, document, event, mailEvent } from "./submission-fixtures";
import { jsonResponse } from "../signing/signing-fixtures";
class EventStream extends EventTarget {
  static streams: EventStream[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    super();
    EventStream.streams.push(this);
  }
  update() {
    this.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "form.completed" }),
      }),
    );
  }
}
function seedSession() {
  saveAuthSession({
    access_token: "test-token",
    user: {
      id: "user",
      email: "admin@example.test",
      role: "admin",
      first_name: "Admin",
      last_name: null,
    },
    account: {
      id: "account",
      name: "Example",
      locale: "en-US",
      timezone: "UTC",
    },
  });
}
let fetchMock: ReturnType<typeof vi.fn>;
let writeClipboard: ReturnType<typeof vi.fn>;
beforeEach(() => {
  routing.push.mockClear();
  notifications.error.mockClear();
  notifications.success.mockClear();
  notifications.info.mockClear();
  EventStream.streams = [];
  seedSession();
  vi.stubGlobal("EventSource", EventStream);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  writeClipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: writeClipboard },
  });
  fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (url.endsWith("?include=fields")) return jsonResponse(submission());
    if (url === "/api/templates/template")
      return jsonResponse({
        documents: [document, { ...document, id: "empty", preview_images: [] }],
      });
    if (url.endsWith("/mail-events"))
      return jsonResponse({ data: [mailEvent()] });
    if (url.endsWith("/events")) return jsonResponse({ data: [event()] });
    if (url.endsWith("/documents"))
      return jsonResponse({
        id: "48",
        documents: [{ name: "Agreement.pdf", url: "/signed.pdf" }],
      });
    throw new Error("Unexpected URL " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
});
async function loadPage() {
  render(<SubmissionDetailPage submissionId="48" />);
  await screen.findByRole("heading", { name: "Customer agreement" });
}
it("loads the async route, template previews, signer values and tenant realtime stream", async () => {
  render(await SubmissionRoute({ params: Promise.resolve({ id: "48" }) }));
  expect(screen.getByText("Loading submission")).toBeTruthy();
  await screen.findByRole("heading", { name: "Customer agreement" });
  expect(
    screen.getByAltText("Customer agreement page 1").getAttribute("src"),
  ).toBe("/page.png");
  expect(screen.getByText("Agreement.pdf")).toBeTruthy();
  expect(screen.getAllByText("Casey Example")).toHaveLength(3);
  expect(screen.getByText("Not completed yet")).toBeTruthy();
  await waitFor(() => expect(EventStream.streams).toHaveLength(1));
  expect(EventStream.streams[0].url).toContain(
    "scope=submission&submission_id=48",
  );
});
it("uses generated completed previews instead of template previews and fills missing document metadata", async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith("?include=fields")
      ? jsonResponse(
          submission({
            status: "completed",
            documents: [
              {
                name: "Signed agreement",
                url: "/signed.pdf",
                preview_images: [
                  {
                    id: "generated",
                    url: "/generated.png",
                    filename: "generated.png",
                    metadata: {},
                  },
                ],
              },
              { name: "Ignored", url: "/ignored.pdf" },
            ],
          }),
        )
      : jsonResponse({ documents: [document] }),
  );
  await loadPage();
  expect(
    screen.getByAltText("Customer agreement page 1").getAttribute("src"),
  ).toBe("/generated.png");
  expect(screen.getByText("Signed agreement.pdf")).toBeTruthy();
  expect(
    screen.getByAltText("Customer agreement page 1").getAttribute("width"),
  ).toBe("1000");
  expect(
    screen.getByAltText("Customer agreement thumbnail").getAttribute("width"),
  ).toBe("200");
});
it("falls back to template previews if completed documents have no generated previews", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse(submission({ status: "completed", documents: [] })),
  );
  await loadPage();
  expect(
    screen.getByAltText("Customer agreement page 1").getAttribute("src"),
  ).toBe("/page.png");
});
it("uses sensible title and return-link fallbacks when the original template is absent", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse(
      submission({
        name: null,
        template: null,
        fields: undefined,
        submitters: [],
      }),
    ),
  );
  render(<SubmissionDetailPage submissionId="48" />);
  const heading = await screen.findByRole("heading", { name: "Submission" });
  expect(heading.closest("a")?.getAttribute("href")).toBe("/templates");
  fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
  expect(notifications.info).toHaveBeenCalledWith(
    "No signer link is available for this submission.",
  );
  expect(writeClipboard).not.toHaveBeenCalled();
});
it("falls back to the template title if the submission has not been named", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(submission({ name: null })));
  render(<SubmissionDetailPage submissionId="48" />);
  await screen.findByRole("heading", { name: "Agreement template" });
});
it("copies the signer share link, resets the label, and clears pending timers on unmount", async () => {
  const timers = vi.spyOn(globalThis, "setTimeout");
  const clear = vi.spyOn(globalThis, "clearTimeout");
  await loadPage();
  fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
  await screen.findByRole("button", { name: "Copied to clipboard" });
  expect(writeClipboard).toHaveBeenCalledWith(
    "http://localhost:3000/s/signer-link",
  );
  fireEvent.click(screen.getByRole("button", { name: "Copied to clipboard" }));
  await waitFor(() => expect(writeClipboard).toHaveBeenCalledTimes(2));
  const callback = timers.mock.calls.find(([, delay]) => delay === 1800)?.[0];
  act(() => {
    if (typeof callback === "function") callback();
  });
  expect(screen.getByRole("button", { name: "Copy share link" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
  await waitFor(() => expect(writeClipboard).toHaveBeenCalledTimes(3));
  expect(clear).toHaveBeenCalled();
});
it("opens the event log, loads activity and delivery traces, and refreshes them through SSE", async () => {
  await loadPage();
  fireEvent.click(screen.getByRole("button", { name: "Open event log" }));
  await screen.findByText("Form completed");
  expect(screen.getByText("Your completed agreement")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "AUDIT LOG" }).getAttribute("href"),
  ).toBe("/audit.pdf");
  const before = fetchMock.mock.calls.length;
  await act(async () => {
    EventStream.streams[0].update();
    await Promise.resolve();
  });
  await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 4));
});
it("refreshes the submission without loading event traces when the dialog is closed", async () => {
  await loadPage();
  const before = fetchMock.mock.calls.length;
  await act(async () => {
    EventStream.streams[0].update();
    await Promise.resolve();
  });
  await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 2));
});
it("downloads signed document links without exposing them through same-window navigation", async () => {
  const clicks = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  await loadPage();
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await waitFor(() => expect(clicks).toHaveBeenCalledOnce());
  const anchor = clicks.mock.instances[0] as HTMLAnchorElement;
  expect([
    anchor.getAttribute("href"),
    anchor.download,
    anchor.target,
    anchor.rel,
  ]).toEqual(["/signed.pdf", "Agreement.pdf", "_blank", "noreferrer"]);
});
it.each([new Error("Unavailable"), null])(
  "handles initial load errors without leaving a loading screen",
  async (failure) => {
    fetchMock.mockRejectedValueOnce(failure);
    render(<SubmissionDetailPage submissionId="48" />);
    await screen.findByText("Submission not found.");
    expect(notifications.error).toHaveBeenCalledWith(
      "Submission could not be loaded",
      {
        description: failure instanceof Error ? failure.message : "Try again.",
      },
    );
  },
);
it("redirects expired sessions to login and also handles a revoked session during realtime refresh", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Expired" }, 401));
  const view = render(<SubmissionDetailPage submissionId="48" />);
  await waitFor(() => expect(routing.push).toHaveBeenCalledWith("/auth/login"));
  view.unmount();
  routing.push.mockClear();
  seedSession();
  await loadPage();
  fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Revoked" }, 401));
  await act(async () => {
    EventStream.streams.at(-1)?.update();
    await Promise.resolve();
  });
  await waitFor(() => expect(routing.push).toHaveBeenCalledWith("/auth/login"));
});
it.each([new Error("Unavailable"), null])(
  "handles event log loading errors",
  async (failure) => {
    await loadPage();
    fetchMock.mockRejectedValueOnce(failure);
    fireEvent.click(screen.getByRole("button", { name: "Open event log" }));
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "Event log could not be loaded",
        {
          description:
            failure instanceof Error ? failure.message : "Try again.",
        },
      ),
    );
    expect(screen.queryByText("Loading events")).toBeNull();
  },
);
it.each([new Error("Unavailable"), null])(
  "handles document download failures",
  async (failure) => {
    await loadPage();
    fetchMock.mockRejectedValueOnce(failure);
    const button = screen.getByRole("button", { name: "Download" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith("Download failed", {
        description: failure instanceof Error ? failure.message : "Try again.",
      }),
    );
    expect(button.hasAttribute("disabled")).toBe(false);
  },
);
it("does not update an unmounted submission view when an initial request succeeds or fails", async () => {
  let resolve: ((response: Response) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const first = render(<SubmissionDetailPage submissionId="48" />);
  first.unmount();
  await act(async () => {
    resolve?.(jsonResponse(submission({ template: null })));
  });
  let reject: ((reason: Error) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((_done, failed) => {
        reject = failed;
      }),
  );
  const second = render(<SubmissionDetailPage submissionId="48" />);
  second.unmount();
  await act(async () => {
    reject?.(new Error("Late rejection"));
  });
  expect(notifications.error).not.toHaveBeenCalled();
});
it("reports clipboard failures and keeps the share control usable", async () => {
  await loadPage();
  writeClipboard.mockRejectedValueOnce(new Error("Clipboard denied"));
  fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith(
      "Share link could not be copied",
      { description: "Clipboard denied" },
    ),
  );
  expect(screen.getByRole("button", { name: "Copy share link" })).toBeTruthy();
});
it.each([null, "missing"])(
  "handles missing or denied clipboard access %s",
  async (failure) => {
    await loadPage();
    if (failure === "missing")
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
    else writeClipboard.mockRejectedValueOnce(failure);
    fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "Share link could not be copied",
        {
          description:
            failure === "missing"
              ? "Clipboard access is unavailable in this browser."
              : "Try copying the link again.",
        },
      ),
    );
    expect(notifications.success).not.toHaveBeenCalled();
  },
);
it("keeps an existing submission visible when a transient realtime refresh fails", async () => {
  await loadPage();
  fetchMock.mockRejectedValueOnce(new Error("Temporary outage"));
  await act(async () => {
    EventStream.streams[0].update();
    await Promise.resolve();
  });
  expect(
    screen.getByRole("heading", { name: "Customer agreement" }),
  ).toBeTruthy();
  expect(routing.push).not.toHaveBeenCalled();
});
it("normalizes explicit generated document identifiers and metadata without replacing them", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse(
      submission({
        status: "completed",
        documents: [
          { ...document, name: "Signed agreement" },
          {
            id: "id-only",
            name: "Annex",
            url: "/annex.pdf",
            preview_images: [
              {
                id: "annex",
                url: "/annex.png",
                filename: "annex.png",
                metadata: {},
              },
            ],
          },
        ],
      }),
    ),
  );
  await loadPage();
  const thumbnails = screen.getAllByAltText("Customer agreement thumbnail");
  expect(thumbnails[0].closest("a")?.getAttribute("href")).toBe(
    "#document-document-0",
  );
  expect(thumbnails[1].closest("a")?.getAttribute("href")).toBe(
    "#document-id-only-0",
  );
});
