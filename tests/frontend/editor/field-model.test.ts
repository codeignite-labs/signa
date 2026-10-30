import { expect, it } from "vitest";
import * as model from "../../../apps/frontend/app/templates/[id]/edit/_lib/template-editor-model";
const area = {
  attachment_uuid: "doc",
  page: 0,
  x: 0.1,
  y: 0.2,
  w: 0.3,
  h: 0.1,
};
const party = { uuid: "party", name: "Signer" };
const field = (
  overrides: Partial<model.TemplateEditorField> = {},
): model.TemplateEditorField => ({
  uuid: "field",
  type: "text",
  name: "Name",
  areas: [area],
  ...overrides,
});
it.each(model.fieldTypes)(
  "creates and converts $type fields with appropriate defaults",
  ({ type, label }) => {
    const created = model.createTemplateField({
      type,
      area,
      fields: [],
      submitter: party,
    });
    expect(created.uuid).toBeTruthy();
    expect(created.submitter_uuid).toBe("party");
    expect(created.name).toBe(`${label} Field 1`);
    expect(created.required).toBe(type !== "checkbox");
    expect(model.getFieldTypeDefinition(type)?.label).toBe(label);
    expect(model.normalizeFieldType(type)).toBe(type);
    const patch = model.buildFieldTypeUpdate(field(), type);
    expect(patch.type).toBe(type);
    if (["radio", "select", "multiple"].includes(type)) {
      expect(created.options).toHaveLength(2);
      expect(patch.options).toHaveLength(2);
    }
    if (type === "stamp") {
      expect(created.readonly).toBe(true);
      expect(patch.readonly).toBe(true);
    }
    if (type === "date")
      expect(created.preferences).toEqual({ format: "MM/DD/YYYY" });
    expect(model.getDefaultAreaSize(type).w).toBeGreaterThan(0);
    expect(
      model.centerDefaultArea({
        attachmentUuid: "doc",
        pageIndex: 0,
        pointer: { x: 0, y: 1 },
        type,
      }),
    ).toMatchObject({ x: 0 });
  },
);
it("retains choice values and date preferences, but clears incompatible boolean defaults and readonly state", () => {
  const existing = field({
    options: [{ uuid: "option", value: "Yes" }],
    readonly: true,
    default_value: true,
    preferences: { format: "YYYY-MM-DD", font_size: 12 },
  });
  expect(model.buildFieldTypeUpdate(existing, "select")).toMatchObject({
    options: existing.options,
    readonly: false,
    default_value: "",
  });
  expect(model.buildFieldTypeUpdate(existing, "date").preferences).toEqual({
    format: "YYYY-MM-DD",
    font_size: 12,
  });
  expect(
    model.buildFieldTypeUpdate(field({ preferences: null }), "date")
      .preferences,
  ).toEqual({ format: "MM/DD/YYYY" });
  expect(model.buildFieldTypeUpdate(existing, "checkbox").default_value).toBe(
    true,
  );
  expect(
    model.buildFieldTypeUpdate(field({ default_value: "yes" }), "checkbox")
      .default_value,
  ).toBe(false);
  expect(model.normalizeFieldType("unsupported")).toBe("text");
  expect(model.buildDefaultFieldName("text", 3)).toBe("Text Field 4");
});
it("normalizes malformed persisted fields, submitters and rectangles without losing unknown extension metadata", () => {
  expect(
    model.normalizeTemplateFields([
      null,
      3,
      {},
      field({ extra: "retained" }),
      { uuid: 3, name: 3, type: "unknown", areas: [null, {}, area] },
    ]),
  ).toMatchObject([
    { name: "", type: "text", areas: [] },
    { extra: "retained", uuid: "field" },
    { name: "", type: "text", areas: [area] },
  ]);
  expect(model.normalizeTemplateSubmitters([])).toMatchObject([
    { name: "First Party" },
  ]);
  expect(
    model.normalizeTemplateSubmitters([
      null,
      {},
      { uuid: "two", name: "Second" },
      { name: " " },
    ]),
  ).toMatchObject([
    { name: "Second Party" },
    { uuid: "two", name: "Second" },
    { name: "Fourth Party" },
  ]);
  expect(
    model.normalizeTemplateArea(
      { attachment_uuid: "doc", page: 1, w: NaN, h: "bad", x: Infinity, y: -4 },
      "text",
    ),
  ).toEqual([{ attachment_uuid: "doc", page: 1, w: 0.2, h: 0.04, x: 0, y: 0 }]);
  for (const invalid of [
    null,
    {},
    { attachment_uuid: 3, page: 0 },
    { attachment_uuid: "doc", page: "0" },
  ])
    expect(model.normalizeTemplateArea(invalid, "text")).toEqual([]);
});
it("makes reusable custom fields independent of signer/document identity and deeply clones options", () => {
  const original = field({
    submitter_uuid: "one",
    prefillable: true,
    conditions: [{ field_uuid: "other" }],
    options: [{ uuid: "old", value: "yes" }],
    areas: [area, { ...area, page: null as unknown as number }],
  });
  const custom = model.buildTemplateCustomField(original);
  expect(custom.uuid).not.toBe(original.uuid);
  expect(custom).not.toHaveProperty("submitter_uuid");
  expect(custom).not.toHaveProperty("conditions");
  expect(custom.areas).toHaveLength(1);
  expect(custom.areas![0]).not.toHaveProperty("attachment_uuid");
  const converted = model.createTemplateFieldFromCustom({
    customField: {
      ...custom,
      options: ["yes", null, { value: "no" }, { value: 3 }],
      role: "ignored",
      title: "Title",
      validation: null,
    },
    area,
    fields: [],
    submitter: party,
  });
  expect(converted.submitter_uuid).toBe("party");
  expect(converted.uuid).not.toBe(custom.uuid);
  expect(converted.options).toMatchObject([
    { value: "yes" },
    { value: "no" },
    { value: "" },
  ]);
  expect(converted.title).toBe("Title");
  expect(
    model.normalizeTemplateCustomFields([
      null,
      {},
      {
        areas: [null, {}, { x: 1, y: 2, w: 0.3, h: 0.4 }],
        name: "Custom",
        type: "text",
      },
    ]),
  ).toMatchObject([
    { type: "text", name: "", areas: [] },
    {
      name: "Custom",
      areas: [
        { x: 0, y: 0, w: 0.2, h: 0.04 },
        { x: 1, y: 2, w: 0.3, h: 0.4 },
      ],
    },
  ]);
  const result = field();
  model.applyCustomFieldAttributes(result, { ...custom, options: "invalid" });
  expect(result.options).toEqual([]);
});
it("normalizes choices and conditions from persisted data safely", () => {
  expect(model.getFieldOptions(field())).toHaveLength(2);
  expect(
    model.getFieldOptions(
      field({ options: [null, 3, {}, { uuid: "existing", value: "A" }] }),
    ),
  ).toMatchObject([{ value: "" }, { uuid: "existing", value: "A" }]);
  expect(model.getFieldConditions(field())).toEqual([]);
  expect(
    model.getFieldConditions(
      field({
        conditions: [
          null,
          3,
          {},
          { field_uuid: "b", action: "equal", value: "yes", operation: "or" },
          { field_uuid: 3, action: 3, value: 3, operation: "and" },
        ],
      }),
    ),
  ).toEqual([
    {
      action: undefined,
      field_uuid: undefined,
      operation: undefined,
      value: undefined,
    },
    { field_uuid: "b", action: "equal", value: "yes", operation: "or" },
    {
      action: undefined,
      field_uuid: undefined,
      operation: undefined,
      value: undefined,
    },
  ]);
});
it("detects direct/indirect condition cycles without confusing unrelated or already visited branches", () => {
  const fields = [
    field({ uuid: "a", conditions: [{ field_uuid: "b" }] }),
    field({ uuid: "b", conditions: [{ field_uuid: "a" }] }),
  ];
  expect(model.createsConditionCycle(fields, "a", "a")).toBe(true);
  expect(model.createsConditionCycle(fields, "a", "b")).toBe(true);
  expect(model.createsConditionCycle(fields, "a", "unrelated")).toBe(false);
  expect(model.createsConditionCycle(fields, "missing", "a")).toBe(false);
  expect(model.createsConditionCycle(fields, "a", "b", new Set(["a"]))).toBe(
    false,
  );
  expect(
    model.createsConditionCycle([field({ conditions: [{}] })], "field", "b"),
  ).toBe(false);
});
it("offers validation formats and type-specific condition actions", () => {
  expect(model.getValidationKind(field())).toBe("");
  expect(
    model.getValidationKind(field({ validation: { pattern: ".{2,8}" } })),
  ).toBe("length");
  expect(model.parseLengthValidation(".{2,}")).toEqual({ min: "2", max: "" });
  expect(model.parseLengthValidation("anything")).toBeNull();
  for (const [name, pattern] of Object.entries(model.fieldValidationPatterns)) {
    expect(model.getValidationKind(field({ validation: { pattern } }))).toBe(
      name,
    );
    expect(model.getValidationPattern(name)).toBe(pattern);
  }
  expect(
    model.getValidationKind(field({ validation: { pattern: "custom" } })),
  ).toBe("custom");
  expect(model.getValidationPattern("unknown")).toBe("");
  expect(model.getDefaultFieldFormat("number")).toBe("none");
  expect(model.getDefaultFieldFormat("date")).toBe("MM/DD/YYYY");
  expect(model.getFieldFormats("number")).toContain("usd");
  expect(model.getFieldFormats("date")).toContain("YYYY-MM-DD");
  expect(model.getConditionActions()).toEqual([]);
  for (const type of [
    "checkbox",
    "radio",
    "select",
    "multiple",
    "number",
    "text",
  ] as const)
    expect(model.getConditionActions(field({ type })).length).toBeGreaterThan(
      0,
    );
  expect(model.requiresConditionValue(undefined, "equal")).toBe(false);
  expect(model.requiresConditionValue(field())).toBe(false);
  expect(model.requiresConditionValue(field({ type: "radio" }), "equal")).toBe(
    true,
  );
  expect(
    model.requiresConditionValue(field({ type: "multiple" }), "empty"),
  ).toBe(false);
  expect(
    model.requiresConditionValue(field({ type: "number" }), "greater_than"),
  ).toBe(true);
  expect(model.requiresConditionValue(field({ type: "number" }), "empty")).toBe(
    false,
  );
  expect(model.requiresConditionValue(field(), "equal")).toBe(false);
  expect(model.humanizeConditionAction("does_not_contain")).toBe(
    "Does Not Contain",
  );
});
