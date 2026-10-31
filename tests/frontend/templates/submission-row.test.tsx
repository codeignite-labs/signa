import { submission } from "./dashboard-fixture";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TemplateSubmissionRow } from "../../../apps/frontend/app/templates/[id]/template-submission-row";

it.each([
  [{ ...submission.submitters[0], name: null }, "signer@example.test"],
  [
    {
      ...submission.submitters[0],
      name: null,
      email: null,
      phone: "+14155552671",
    },
    "+14155552671",
  ],
  [undefined, "Recipient"],
])(
  "chooses available recipient identifiers for incomplete submissions %#",
  (recipient, label) => {
    render(
      <TemplateSubmissionRow
        disabled={false}
        onArchive={vi.fn()}
        submission={{ ...submission, submitters: recipient ? [recipient] : [] }}
      />,
    );
    expect(screen.getByRole("link", { name: label })).toBeTruthy();
    expect(
      screen.getByText(recipient?.status ?? submission.status),
    ).toBeTruthy();
  },
);
it.each(["completed", "declined"])(
  "shows %s state without offering another signing action",
  (status) => {
    const archive = vi.fn();
    render(
      <TemplateSubmissionRow
        disabled={false}
        onArchive={archive}
        submission={{
          ...submission,
          submitters: [{ ...submission.submitters[0], status }],
        }}
      />,
    );
    expect(screen.getByText(status)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "SIGN NOW" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Archive submission" }));
    expect(archive).toHaveBeenCalledOnce();
  },
);
it("disables archive actions while the parent mutation is pending", () => {
  const archive = vi.fn();
  render(
    <TemplateSubmissionRow
      disabled
      onArchive={archive}
      submission={submission}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Archive submission" }));
  expect(archive).not.toHaveBeenCalled();
});
