import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "../../../apps/frontend/components/reui/timeline";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "../../../apps/frontend/components/ui/card";
function Steps({
  value,
  orientation,
}: {
  value?: number;
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <Timeline
      defaultValue={2}
      value={value}
      orientation={orientation}
      onValueChange={vi.fn()}
    >
      {[1, 2, 3].map((step) => (
        <TimelineItem key={step} step={step} data-testid={`step-${step}`}>
          <TimelineHeader>
            <TimelineDate>October {step}, 2026</TimelineDate>
            <TimelineTitle>Stage {step}</TimelineTitle>
            <TimelineIndicator>●</TimelineIndicator>
          </TimelineHeader>
          <TimelineContent>Step {step} details</TimelineContent>
          <TimelineSeparator />
        </TimelineItem>
      ))}
    </Timeline>
  );
}
it("marks completed timeline stages from uncontrolled defaults and controlled updates", () => {
  const view = render(<Steps />);
  expect(screen.getByTestId("step-1").getAttribute("data-completed")).toBe(
    "true",
  );
  expect(screen.getByTestId("step-2").getAttribute("data-completed")).toBe(
    "true",
  );
  expect(screen.getByTestId("step-3").hasAttribute("data-completed")).toBe(
    false,
  );
  expect(screen.getByText("Stage 1").tagName).toBe("H3");
  expect(screen.getByText("October 1, 2026").tagName).toBe("TIME");
  view.rerender(<Steps value={3} orientation="horizontal" />);
  expect(screen.getByTestId("step-3").getAttribute("data-completed")).toBe(
    "true",
  );
  expect(
    view.container
      .querySelector("[data-slot=timeline]")
      ?.getAttribute("data-orientation"),
  ).toBe("horizontal");
});
it("supports slotted timeline dates and indicators without creating extra wrapper elements", () => {
  render(
    <Timeline>
      <TimelineItem step={1}>
        <TimelineDate asChild>
          <span data-testid="date">Oct 31</span>
        </TimelineDate>
        <TimelineIndicator asChild>
          <span data-testid="indicator">Ready</span>
        </TimelineIndicator>
      </TimelineItem>
    </Timeline>,
  );
  expect(screen.getByTestId("date").getAttribute("data-slot")).toBe(
    "timeline-date",
  );
  expect(screen.getByTestId("indicator").getAttribute("aria-hidden")).toBe(
    "true",
  );
});
it("rejects timeline items without a containing timeline", () => {
  expect(() => render(<TimelineItem step={1} />)).toThrow(
    "useTimeline must be used within a Timeline",
  );
});
it("composes a card with a title, explanation, action, content and footer while forwarding DOM props", () => {
  const view = render(
    <Card size="sm" data-testid="card">
      <CardHeader>
        <CardTitle>Signing identity</CardTitle>
        <CardDescription>Used for new documents</CardDescription>
        <CardAction>
          <button>Replace identity</button>
        </CardAction>
      </CardHeader>
      <CardContent>Organization certificate</CardContent>
      <CardFooter>Updated today</CardFooter>
    </Card>,
  );
  expect(screen.getByTestId("card").getAttribute("data-size")).toBe("sm");
  expect(screen.getByRole("button", { name: "Replace identity" })).toBeTruthy();
  expect(
    view.container.querySelector("[data-slot=card-content]")?.textContent,
  ).toBe("Organization certificate");
  expect(
    view.container.querySelector("[data-slot=card-footer]")?.textContent,
  ).toBe("Updated today");
});
