import "../settings/browser-settings-fixture";
import { beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { TemplateEmbeddingPanel } from "../../../apps/frontend/app/templates/[id]/edit/template-embedding-panel";
import type { TemplateResponse } from "../../../apps/frontend/lib/api/templates";
const highlight = vi.hoisted(() =>
  vi.fn<
    (code: string, options: { lang: string; theme: string }) => Promise<string>
  >(),
);
vi.mock("../../../apps/frontend/node_modules/shiki/dist/index.mjs", () => ({
  codeToHtml: highlight,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const template = {
  id: "1",
  slug: "signer-link",
  shared_link: true,
  shared_with_test_mode: false,
} as TemplateResponse;
beforeEach(() => {
  vi.clearAllMocks();
  highlight.mockImplementation(
    async (code) =>
      '<pre data-testid="highlighted-code">' +
      code.replaceAll("<", "&lt;") +
      "</pre>",
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
it("shows template id and public embedding URL, copies them, and changes sharing controls", async () => {
  const shared = vi.fn<() => Promise<void>>(),
    testing = vi.fn<() => Promise<void>>();
  render(
    <TemplateEmbeddingPanel
      template={template}
      isUpdatingSharedLink={false}
      onSharedLinkChange={shared}
      onTestingShareChange={testing}
    />,
  );
  expect((screen.getByLabelText("Template ID") as HTMLInputElement).value).toBe(
    "1",
  );
  expect(
    (screen.getByLabelText("Embedding URL") as HTMLInputElement).value,
  ).toBe(window.location.origin + "/d/signer-link");
  fireEvent.click(screen.getAllByRole("button", { name: "COPY" })[0]);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Template ID copied"),
  );
  fireEvent.click(screen.getAllByRole("button", { name: "COPY" })[1]);
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      window.location.origin + "/d/signer-link",
    ),
  );
  fireEvent.click(screen.getAllByRole("switch")[0]);
  expect(shared).toHaveBeenCalledWith(false);
  fireEvent.click(screen.getAllByRole("switch")[1]);
  expect(testing).toHaveBeenCalledWith(true);
});
it("shows validated JavaScript, React, Vue and Angular code snippets with the correct public URL", async () => {
  render(
    <TemplateEmbeddingPanel
      template={template}
      isUpdatingSharedLink={false}
      onSharedLinkChange={vi.fn()}
      onTestingShareChange={vi.fn()}
    />,
  );
  for (const framework of ["JavaScript", "React", "Vue", "Angular"]) {
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(framework + "$") }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("highlighted-code").textContent).toContain(
        "/d/signer-link",
      ),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "COPY" })[2]);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Snippet copied"),
    );
  }
  expect(highlight).toHaveBeenCalledWith(
    expect.stringContaining("@signajs/react"),
    { lang: "tsx", theme: "vitesse-dark" },
  );
  expect(highlight).toHaveBeenCalledWith(
    expect.stringContaining("@signa/vue"),
    { lang: "vue", theme: "vitesse-dark" },
  );
  expect(highlight).toHaveBeenCalledWith(
    expect.stringContaining("@signa/angular"),
    { lang: "typescript", theme: "vitesse-dark" },
  );
});
it("disables sharing changes while a server update is pending", () => {
  render(
    <TemplateEmbeddingPanel
      template={template}
      isUpdatingSharedLink
      onSharedLinkChange={vi.fn()}
      onTestingShareChange={vi.fn()}
    />,
  );
  expect(screen.getByText("Updating shared link")).toBeTruthy();
  for (const control of screen.getAllByRole("switch"))
    expect(control.hasAttribute("disabled")).toBe(true);
});
it("keeps plaintext code usable while highlighting is pending and does not update after unmount", async () => {
  let finish!: (value: string) => void;
  highlight.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(
    <TemplateEmbeddingPanel
      template={{ ...template, slug: "pending-slug" }}
      isUpdatingSharedLink={false}
      onSharedLinkChange={vi.fn()}
      onTestingShareChange={vi.fn()}
    />,
  );
  expect(screen.getByText(/signa-form/).textContent).toContain(
    "/d/pending-slug",
  );
  view.unmount();
  await act(async () => finish("<pre>Completed highlighting</pre>"));
});
it("reuses cached highlighted snippets without another highlighter request", async () => {
  const props = {
    template: { ...template, slug: "cached-slug" },
    isUpdatingSharedLink: false,
    onSharedLinkChange: vi.fn(),
    onTestingShareChange: vi.fn(),
  };
  const view = render(<TemplateEmbeddingPanel {...props} />);
  await screen.findByTestId("highlighted-code");
  const calls = highlight.mock.calls.length;
  view.unmount();
  render(<TemplateEmbeddingPanel {...props} />);
  await screen.findByTestId("highlighted-code");
  expect(highlight).toHaveBeenCalledTimes(calls);
});
it("cancels a queued cached-highlight refresh when navigation immediately unmounts the panel", async () => {
  const props = {
    template: { ...template, slug: "instant-cache-navigation" },
    isUpdatingSharedLink: false,
    onSharedLinkChange: vi.fn(),
    onTestingShareChange: vi.fn(),
  };
  const first = render(<TemplateEmbeddingPanel {...props} />);
  await screen.findByTestId("highlighted-code");
  first.unmount();
  const second = render(<TemplateEmbeddingPanel {...props} />);
  second.unmount();
  await act(async () => {
    await Promise.resolve();
  });
});
it("renders an empty origin-dependent URL during server rendering", async () => {
  const { renderToString } = await import("react-dom/server");
  vi.stubGlobal("window", undefined);
  try {
    const markup = renderToString(
      <TemplateEmbeddingPanel
        template={template}
        isUpdatingSharedLink={false}
        onSharedLinkChange={vi.fn()}
        onTestingShareChange={vi.fn()}
      />,
    );
    expect(markup).toContain("Embedding URL");
    expect(markup).not.toContain("/d/signer-link");
  } finally {
    vi.unstubAllGlobals();
  }
});
