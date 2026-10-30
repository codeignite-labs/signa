import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  SubmissionDocumentPreview,
  SubmissionDocumentThumbnails,
} from "../../../apps/frontend/app/submissions/[id]/submission-document-viewer";
import { SubmissionPartiesPanel } from "../../../apps/frontend/app/submissions/[id]/submission-parties-panel";
import { submission, party, document } from "./submission-fixtures";
it("renders saved and declined parties, supports missing identities, and keeps field summaries scoped", () => {
  const record = submission({
    submitters: [
      { ...party, completed_at: "2026-10-30T12:00:00Z" },
      {
        ...party,
        id: "second",
        uuid: "second",
        name: null,
        email: null,
        role: "",
        declined_at: "2026-10-29T12:00:00Z",
        values: [{ field: "field", value: "Second signer only" }],
      },
      {
        ...party,
        id: "third",
        uuid: "third",
        name: null,
        email: null,
        role: "",
        values: [],
      },
    ],
  });
  const fields = [
    { uuid: "first", name: "Name", submitter_uuid: "signer" },
    { name: "Legacy label", submitter_uuid: "signer" },
    { uuid: "field", title: "Second signature", submitter_uuid: "second" },
  ];
  render(<SubmissionPartiesPanel fields={fields} submission={record} />);
  expect(screen.getByText(/Completed Oct 30, 2026/)).toBeTruthy();
  expect(screen.getByText(/Declined Oct 29, 2026/)).toBeTruthy();
  expect(screen.getByText("Not completed yet")).toBeTruthy();
  expect(screen.getByText("2 Submitter")).toBeTruthy();
  expect(screen.getByText("3 Submitter")).toBeTruthy();
  expect(screen.getByText("Second signature")).toBeTruthy();
  expect(screen.getByText("Second signer only")).toBeTruthy();
  expect(screen.getAllByText("Casey Example")).toHaveLength(2);
  expect(screen.getByText("casey@example.test")).toBeTruthy();
});
it("omits missing thumbnails and applies finite metadata fallbacks while linking to the right page", () => {
  const documents = [
    {
      ...document,
      name: "Agreement",
      preview_images: [
        {
          ...document.preview_images[0],
          metadata: { width: Number.NaN, height: "invalid" },
        },
      ],
    },
    { ...document, uuid: "empty", name: "Empty", preview_images: [] },
  ];
  render(
    <SubmissionDocumentThumbnails documents={documents} title="Agreement" />,
  );
  const image = screen.getByAltText("Agreement thumbnail");
  expect(image.getAttribute("width")).toBe("200");
  expect(image.getAttribute("height")).toBe("280");
  expect(image.closest("a")?.getAttribute("href")).toBe("#document-document-0");
  expect(screen.getAllByRole("img")).toHaveLength(1);
});
it("renders overlay defaults only for the matching document/page and removes overlays on completed PDFs", () => {
  const documents = [
    {
      ...document,
      name: "Agreement",
      preview_images: [
        {
          ...document.preview_images[0],
          metadata: { width: Number.POSITIVE_INFINITY, height: null },
        },
      ],
    },
  ];
  const fields = [
    {
      uuid: "field",
      name: "Name",
      areas: [
        { attachment_uuid: "document", page: 0 },
        { attachment_uuid: "other", page: 0 },
        { attachment_uuid: "document", page: 1 },
      ],
    },
    { uuid: "missing" },
    { uuid: "empty", areas: [] },
  ];
  const view = render(
    <SubmissionDocumentPreview
      documents={documents}
      fields={fields}
      showFieldOverlays
      submission={submission()}
      title="Agreement"
    />,
  );
  const image = screen.getByAltText("Agreement page 1");
  expect(image.getAttribute("width")).toBe("1000");
  expect(image.getAttribute("height")).toBe("1400");
  expect(screen.getByText("Casey Example")).toBeTruthy();
  const overlay = screen.getByText("Casey Example").parentElement!;
  expect(overlay.style.width).toBe("20%");
  expect(overlay.style.height).toBe("4%");
  expect(overlay.style.left).toBe("0%");
  expect(overlay.style.top).toBe("0%");
  view.rerender(
    <SubmissionDocumentPreview
      documents={documents}
      fields={fields}
      showFieldOverlays={false}
      submission={submission({ status: "completed" })}
      title="Agreement"
    />,
  );
  expect(screen.queryByText("Casey Example")).toBeNull();
});
