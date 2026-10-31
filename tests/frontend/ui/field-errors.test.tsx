import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  FieldError,
  FieldSeparator,
} from "../../../apps/frontend/components/ui/field";

it("lets explicit error content take precedence over validator messages", () => {
  render(
    <FieldError errors={[{ message: "Invalid" }]}>Please try again</FieldError>,
  );
  expect(screen.getByRole("alert").textContent).toBe("Please try again");
});
it.each([undefined, [], [undefined], [{}]])(
  "omits empty errors %j",
  (errors) => {
    render(<FieldError errors={errors} />);
    expect(screen.queryByRole("alert")).toBeNull();
  },
);
it("deduplicates identical validation errors into a single message", () => {
  render(
    <FieldError errors={[{ message: "Required" }, { message: "Required" }]} />,
  );
  expect(screen.getByRole("alert").textContent).toBe("Required");
  expect(screen.queryByRole("list")).toBeNull();
});
it("lists distinct messages while omitting missing validation messages", () => {
  render(
    <FieldError
      errors={[
        undefined,
        { message: "Required" },
        {},
        { message: "Too short" },
      ]}
    />,
  );
  expect(
    screen.getAllByRole("listitem").map((item) => item.textContent),
  ).toEqual(["Required", "Too short"]);
});
it("renders a plain separator without inventing a caption", () => {
  const { container } = render(<FieldSeparator />);
  expect(container.querySelector('[data-content="false"]')).not.toBeNull();
  expect(
    container.querySelector('[data-slot="field-separator-content"]'),
  ).toBeNull();
});
it("renders a labeled separator with its accessible caption", () => {
  const { container } = render(<FieldSeparator>Or continue</FieldSeparator>);
  expect(screen.getByText("Or continue")).toBeTruthy();
  expect(container.querySelector('[data-content="true"]')).not.toBeNull();
});
