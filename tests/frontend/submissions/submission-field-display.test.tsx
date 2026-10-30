import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  SubmissionFieldValue,
  buildSingleSubmitterSubmission,
  compareFieldsByDocumentPosition,
} from "../../../apps/frontend/app/submissions/[id]/submission-field-display";
import type { SigningField } from "../../../apps/frontend/lib/api/signing";
import { party, submission } from "./submission-fixtures";
it.each([
  ["text", "Name", "Casey", "Casey"],
  ["checkbox", "Consent", true, "✓"],
  ["checkbox", "Consent", false, ""],
  ["signature", undefined, null, "Sign Here"],
  ["signature", "Signature", "uuid", "Signed"],
  ["initials", "Initials", [], "Initials"],
  ["file", undefined, "", "Upload"],
  ["file", "Documents", ["uuid"], "Uploaded"],
  ["image", "Photo", undefined, "Photo"],
])(
  "displays %s values and meaningful empty state labels",
  (type, name, value, expected) => {
    const field = { type, uuid: "field", name };
    const record = submission({
      submitters: [{ ...party, values: [{ field: "field", value }] }],
    });
    const view = render(
      <SubmissionFieldValue field={field} submission={record} />,
    );
    expect(view.container.textContent).toBe(expected);
  },
);
it.each([
  ["text", "Default"],
  ["text", 42],
  ["text", false],
  ["text", null],
  ["text", undefined],
])(
  "uses a %s default %s when no signer has supplied a value",
  (type, default_value) => {
    const field = { type, name: "Fallback", default_value };
    const view = render(
      <SubmissionFieldValue
        field={field}
        submission={submission({
          submitters: [{ ...party, values: undefined }],
        })}
      />,
    );
    expect(view.container.textContent).toBe(
      default_value == null ? "Fallback" : String(default_value),
    );
  },
);
it("searches signer values by name and UUID, returning the first matching signer", () => {
  render(
    <SubmissionFieldValue
      field={{ uuid: "field", name: "Name" }}
      submission={submission({
        submitters: [
          { ...party, values: [] },
          {
            ...party,
            id: "second",
            values: [
              { field: "Name", value: "First match" },
              { field: "field", value: "Later" },
            ],
          },
        ],
      })}
    />,
  );
  expect(screen.getByText("First match")).toBeTruthy();
  expect(screen.queryByText("Later")).toBeNull();
});
it.each(["signature", "initials", "image", "file"])(
  "renders image attachments for %s",
  (type) => {
    const attachment = {
      uuid: "asset",
      filename: "signature.png",
      content_type: "image/png",
      url: "/signature.png",
    };
    render(
      <SubmissionFieldValue
        field={{ type, uuid: "field" }}
        submission={submission({
          submitters: [
            {
              ...party,
              values: [{ field: "field", value: "asset", attachment }],
            },
          ],
        })}
      />,
    );
    expect(screen.getByAltText("signature.png").getAttribute("src")).toBe(
      "/signature.png",
    );
  },
);
it.each([null, "application/pdf"])(
  "links non-image file attachments with content type %s",
  (content_type) => {
    const attachment = {
      uuid: "asset",
      filename: "supporting.pdf",
      content_type,
      url: "/supporting.pdf",
    };
    render(
      <SubmissionFieldValue
        field={{ type: "file", uuid: "field" }}
        submission={submission({
          submitters: [
            {
              ...party,
              values: [{ field: "field", value: "asset", attachment }],
            },
          ],
        })}
      />,
    );
    const link = screen.getByRole("link", { name: "supporting.pdf" });
    expect(link.getAttribute("href")).toBe("/supporting.pdf");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  },
);
it("scopes a summary to one submitter without exposing another signer values", () => {
  expect(buildSingleSubmitterSubmission(party)).toEqual({
    submitters: [party],
  });
});
it.each<[SigningField, SigningField, number]>([
  [{}, {}, 0],
  [{ areas: [{}] }, {}, -1],
  [{}, { areas: [{}] }, 1],
  [{ areas: [{ page: 0 }] }, { areas: [{ page: 1 }] }, -1],
  [{ areas: [{}] }, { areas: [{ page: 1 }] }, -1],
  [{ areas: [{ page: 1 }] }, { areas: [{}] }, 1],
  [{ areas: [{ y: 0.1 }] }, { areas: [{ y: 0.2 }] }, -0.1],
  [{ areas: [{}] }, { areas: [{ y: 0.2 }] }, -0.2],
  [{ areas: [{ y: 0.2 }] }, { areas: [{}] }, 0.2],
  [{ areas: [{ x: 0.1 }] }, { areas: [{ x: 0.2 }] }, -0.1],
  [{ areas: [{}] }, { areas: [{}] }, 0],
])(
  "orders fields by page, vertical and horizontal position without mutating fields",
  (left, right, expected) => {
    const original = structuredClone([left, right]);
    expect(compareFieldsByDocumentPosition(left, right)).toBeCloseTo(expected);
    expect([left, right]).toEqual(original);
  },
);
