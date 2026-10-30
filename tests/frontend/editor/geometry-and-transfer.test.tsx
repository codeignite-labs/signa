import React from "react";
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import * as model from "../../../apps/frontend/app/templates/[id]/edit/_lib/template-editor-model";
import type {
  TemplateDocument,
  TemplateResponse,
} from "../../../apps/frontend/lib/api/templates";
const area = { attachment_uuid: "a", page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
const field = (
  id: string,
  areas: model.TemplateFieldArea[] = [],
): model.TemplateEditorField => ({ uuid: id, type: "text", name: id, areas });
it("constrains rectangles to page bounds and orders fields spatially without mutating the input", () => {
  expect(
    model.normalizeArea({ ...area, x: -10, y: 4, w: 2, h: -2 }),
  ).toMatchObject({ x: 0, y: 1, w: 1, h: 0 });
  expect(model.areaToStyle(area)).toEqual({
    left: "10%",
    top: "10%",
    width: "20%",
    height: "10%",
  });
  for (const [a, b] of [
    [area, { ...area, attachment_uuid: "b" }],
    [area, { ...area, page: 1 }],
    [area, { ...area, y: 0.3 }],
    [area, { ...area, x: 0.5 }],
  ])
    expect(model.compareAreas(a, b)).toBeLessThan(0);
  expect(model.compareFieldsByFirstArea(field("empty"), field("other"))).toBe(
    0,
  );
  expect(
    model.compareFieldsByFirstArea(field("empty"), field("full", [area])),
  ).toBe(1);
  const fields = [field("full", [area])];
  expect(
    model
      .insertFieldSorted(fields, field("before", [{ ...area, y: 0 }]))
      .map((f) => f.uuid),
  ).toEqual(["before", "full"]);
  expect(fields).toHaveLength(1);
  for (const value of [-10, 0, 0.5, 1, 10])
    expect(model.clamp01(value)).toBeGreaterThanOrEqual(0);
  expect(model.getFiniteNumber(3, 1)).toBe(3);
  expect(model.getFiniteNumber(NaN, 1)).toBe(1);
  expect(model.getFiniteNumber("3", 1)).toBe(1);
  expect(model.getPreviewDimension(3, 1)).toBe(3);
  expect(model.getPreviewDimension(-3, 1)).toBe(1);
  expect(model.getPreviewDimension(NaN, 1)).toBe(1);
});
it("serializes only supported drag payloads and rejects malformed clipboard data", () => {
  let value = "";
  const transfer = {
    effectAllowed: "",
    types: [],
    setData: vi.fn((key: string, data: string) => {
      if (key === model.FIELD_DRAG_MIME_TYPE) value = data;
    }),
    getData: () => value,
  } as unknown as DataTransfer;
  expect(model.readFieldDragPayload(transfer)).toBeNull();
  expect(model.hasFieldDragPayload(transfer)).toBe(false);
  const payloads: model.FieldDragPayload[] = [
    { kind: "new", type: "text" },
    { kind: "existing", fieldUuid: "f" },
    { kind: "existing", fieldUuid: "f", optionUuid: "o" },
    { kind: "custom", customFieldUuid: "c", type: "signature" },
  ];
  for (const payload of payloads) {
    model.writeFieldDragPayload(transfer, payload);
    expect(model.readFieldDragPayload(transfer)).toEqual(payload);
  }
  (transfer as unknown as { types: string[] }).types = [
    model.FIELD_DRAG_MIME_TYPE,
  ];
  expect(model.hasFieldDragPayload(transfer)).toBe(true);
  expect(transfer.effectAllowed).toBe("copy");
  for (const raw of [
    "bad",
    "null",
    "{}",
    '{"kind":4}',
    '{"kind":"new"}',
    '{"kind":"existing"}',
    '{"kind":"custom"}',
    '{"kind":"unknown"}',
  ]) {
    value = raw;
    expect(model.readFieldDragPayload(transfer)).toBeNull();
  }
  value = '{"kind":"new","type":"unsupported"}';
  expect(model.readFieldDragPayload(transfer)).toEqual({
    kind: "new",
    type: "text",
  });
  expect(model.safeParseJson("bad")).toBeNull();
  expect(model.safeParseJson('{"ok":true}')).toEqual({ ok: true });
});
it("rewrites and removes document areas while preserving other documents and malformed legacy values", () => {
  const fields = [
    null,
    {},
    field("empty"),
    field("a", [area]),
    field("mixed", [area, { ...area, attachment_uuid: "b" }]),
    { areas: [null] },
  ];
  expect(model.rewriteFieldAttachmentUuid(fields, "a", "new")).toMatchObject([
    null,
    {},
    { areas: [] },
    { areas: [{ attachment_uuid: "new" }] },
    { areas: [{ attachment_uuid: "new" }, { attachment_uuid: "b" }] },
    { areas: [null] },
  ]);
  const remaining = model.removeFieldsForAttachment(fields, "a");
  expect(remaining).toEqual([
    null,
    {},
    field("mixed", [{ ...area, attachment_uuid: "b" }]),
    { areas: [null] },
  ]);
});
it("uses ordinal labels and cyclic colors while preserving explicit signer names", () => {
  for (const [n, suffix] of [
    [1, "st"],
    [2, "nd"],
    [3, "rd"],
    [4, "th"],
    [11, "th"],
    [12, "th"],
    [13, "th"],
    [21, "st"],
  ] as const)
    expect(model.getOrdinalSuffix(n)).toBe(suffix);
  expect(model.getPartyName(0)).toBe("First Party");
  expect(model.getPartyName(20)).toBe("21st Party");
  expect(model.getSubmitterName([])).toBe("First Party");
  expect(model.getSubmitterName([{ uuid: "a", name: "Actual" }], "a")).toBe(
    "Actual",
  );
  expect(model.getSubmitterColor([], undefined)).toBe(model.submitterColors[0]);
  expect(model.getSubmitterColor([{ uuid: "a" }, { uuid: "b" }], "b")).toBe(
    model.submitterColors[1],
  );
  expect(model.getFieldStringValue("A")).toBe("A");
  expect(model.getFieldStringValue(42)).toBe("42");
  expect(model.getFieldStringValue(null)).toBe("");
  expect(model.getAutosizeInputCh("")).toBe(2);
  expect(model.getAutosizeInputCh("x".repeat(100))).toBe(32);
  expect(model.isTextEditableField("text")).toBe(true);
  expect(model.isTextEditableField("image")).toBe(false);
});
it("renders preview fallback and names documents from schema or filename", () => {
  const doc = {
    uuid: "doc",
    filename: "contract.pdf",
    preview_images: [],
    preview_image_url: null,
  } as unknown as TemplateDocument;
  const page = render(<model.DocumentThumbnail />);
  expect(page.container.querySelector("svg")).toBeTruthy();
  page.rerender(
    <model.DocumentThumbnail
      document={{ ...doc, preview_image_url: "https://files.example/preview" }}
    />,
  );
  expect(page.getByAltText("contract.pdf").getAttribute("src")).toBe(
    "https://files.example/preview",
  );
  page.rerender(
    <model.DocumentThumbnail
      document={{
        ...doc,
        preview_images: [
          { url: "https://files.example/page" },
        ] as TemplateDocument["preview_images"],
      }}
    />,
  );
  expect(page.getByAltText("contract.pdf").getAttribute("src")).toContain(
    "/page",
  );
  expect(
    model.getDocumentDisplayName(
      {
        schema: [{ attachment_uuid: "doc", name: "Named" }],
      } as TemplateResponse,
      doc,
    ),
  ).toBe("Named");
  expect(
    model.getDocumentDisplayName(
      { schema: [] } as unknown as TemplateResponse,
      doc,
    ),
  ).toBe("contract");
  expect(model.removeExtension("folder/name.ext")).toBe("folder/name");
  expect(model.isRecord([])).toBe(false);
});
it("downloads sequentially, names files and revokes temporary object URLs", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response("file"));
  vi.stubGlobal("fetch", fetch);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn().mockReturnValue("blob:test"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  await model.downloadUrlsSequentially([
    "https://files.example/one.pdf",
    "https://files.example/two.pdf",
  ]);
  expect(fetch.mock.calls.map((c) => c[0])).toEqual([
    "https://files.example/one.pdf",
    "https://files.example/two.pdf",
  ]);
  expect(click).toHaveBeenCalledTimes(2);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
