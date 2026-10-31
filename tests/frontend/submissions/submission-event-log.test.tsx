import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SubmissionEventLogDialog } from "../../../apps/frontend/app/submissions/[id]/submission-event-log-dialog";
import { event, mailEvent } from "./submission-fixtures";
it("shows loading events and closes through the real dialog control", () => {
  const changed = vi.fn();
  render(
    <SubmissionEventLogDialog
      events={[]}
      mailEvents={[]}
      isLoading
      open
      onOpenChange={changed}
    />,
  );
  expect(screen.getByText("Loading events")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(changed).toHaveBeenCalledWith(false);
});
it("renders event metadata, device types, fallback icons and repeated timeline colors", () => {
  const events = [
    event(),
    event({
      id: "tablet",
      device: "tablet",
      actor: null,
      message: "",
      browser: null,
      os: null,
      ip: null,
      timezone: null,
    }),
    event({ id: "desktop", device: "desktop", icon: "unknown" }),
    event({ id: "none", device: null }),
    ...[
      "eye",
      "file_text",
      "hand_click",
      "mail_forward",
      "player_play",
      "x",
    ].map((icon, index) => event({ id: icon, icon, title: `Event ${index}` })),
  ];
  render(
    <SubmissionEventLogDialog
      events={events}
      mailEvents={[]}
      isLoading={false}
      open
      onOpenChange={vi.fn()}
      auditLogUrl="/audit.pdf"
      combinedDocumentUrl="/combined.pdf"
    />,
  );
  expect(
    screen.getByRole("link", { name: "AUDIT LOG" }).getAttribute("href"),
  ).toBe("/audit.pdf");
  expect(
    screen.getByRole("link", { name: "COMBINED PDF" }).getAttribute("href"),
  ).toBe("/combined.pdf");
  expect(
    screen.getAllByText("Chrome on Android · IP 192.0.2.1 · Africa/Nairobi"),
  ).toHaveLength(9);
  expect(screen.getAllByTitle("mobile").length).toBeGreaterThan(1);
  expect(screen.getByTitle("tablet")).toBeTruthy();
  expect(screen.getByTitle("desktop")).toBeTruthy();
  expect(screen.queryByText("Mail delivery")).toBeNull();
});
it("shows sent/failed/skipped/pending delivery traces and chooses the available delivery timestamp", () => {
  const rows = [
    mailEvent(),
    mailEvent({
      id: "failed",
      status: "failed",
      sent_at: null,
      failed_at: "2026-10-29T12:00:00Z",
      last_error_message: "Mailbox rejected",
      provider_response: "550 unavailable",
    }),
    mailEvent({
      id: "skipped",
      status: "skipped",
      sent_at: null,
      skipped_at: "2026-10-28T12:00:00Z",
    }),
    mailEvent({
      id: "queued",
      status: "queued",
      sent_at: null,
      created_at: "2026-10-27T12:00:00Z",
    }),
  ];
  render(
    <SubmissionEventLogDialog
      events={[]}
      mailEvents={rows}
      isLoading={false}
      open
      onOpenChange={vi.fn()}
    />,
  );
  for (const row of rows) expect(screen.getByText(row.status)).toBeTruthy();
  expect(screen.getByText("Mailbox rejected")).toBeTruthy();
  expect(screen.getByText("Provider response: 550 unavailable")).toBeTruthy();
  expect(screen.getAllByText("Attempt: 1")).toHaveLength(4);
  expect(screen.getAllByText(/Oct \d+, 2026/)).toHaveLength(4);
});
