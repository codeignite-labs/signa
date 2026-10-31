import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import * as auth from "../../../apps/frontend/lib/api/auth";
import * as submissions from "../../../apps/frontend/lib/api/submissions";
import { createTemplateEditorSigningActions } from "../../../apps/frontend/app/templates/[id]/edit/_hooks/template-editor-signing-actions";
import { signer, templateFixture } from "./fixtures";
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("../../../apps/frontend/lib/api/submissions", () => ({
  createSubmission: vi.fn(),
}));
function setup(currentSubmitters = [signer]) {
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  };
  const setIsOpeningSelfSign = vi.fn();
  const actions = createTemplateEditorSigningActions({
    currentSubmitters,
    currentTemplate: templateFixture(),
    router,
    setIsOpeningSelfSign,
  });
  return { actions, router, setIsOpeningSelfSign };
}
let popup: {
  location: { href: string };
  focus: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  popup = { location: { href: "" }, focus: vi.fn(), close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  vi.mocked(submissions.createSubmission).mockResolvedValue([
    { slug: "sign-link" } as submissions.SubmissionSubmitterResponse,
  ]);
  auth.saveAuthSession({
    access_token: "token",
    user: {
      id: "user",
      email: "user@example.test",
      first_name: "First",
      last_name: "Last",
      role: "admin",
    },
    account: {
      id: "account",
      name: "Example",
      locale: "en-US",
      timezone: "UTC",
    },
  });
});
it("opens a self-signing form for the current authenticated user", async () => {
  const { actions, setIsOpeningSelfSign } = setup();
  await actions.openSelfSigningForm();
  expect(submissions.createSubmission).toHaveBeenCalledWith({
    name: "Agreement",
    template_id: "template",
    submitters: [
      { email: "user@example.test", name: "First Last", role: "First Party" },
    ],
  });
  expect(popup.location.href).toBe("/s/sign-link");
  expect(popup.focus).toHaveBeenCalledOnce();
  expect(setIsOpeningSelfSign.mock.calls).toEqual([[true], [false]]);
});
it("falls back to the router when a popup is blocked and to email for a missing display name", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  const session = auth.getAuthSession()!;
  auth.saveAuthSession({
    ...session,
    user: { ...session.user, first_name: null, last_name: null },
  });
  const { actions, router } = setup();
  await actions.openSelfSigningForm();
  expect(router.push).toHaveBeenCalledWith("/s/sign-link");
  expect(submissions.createSubmission).toHaveBeenCalledWith(
    expect.objectContaining({
      submitters: [expect.objectContaining({ name: "user@example.test" })],
    }),
  );
});
it("supports a missing session display name and guards missing roles", async () => {
  auth.clearAuthSession();
  const { actions } = setup([
    { uuid: "signer", name: undefined } as unknown as typeof signer,
  ]);
  await actions.openSelfSigningForm();
  expect(submissions.createSubmission).toHaveBeenCalledWith(
    expect.objectContaining({
      submitters: [
        { email: undefined, name: "Self signer", role: "First Party" },
      ],
    }),
  );
  vi.mocked(submissions.createSubmission).mockClear();
  await setup([]).actions.openSelfSigningForm();
  expect(submissions.createSubmission).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(
    "Self-signing form could not be opened",
    expect.any(Object),
  );
});
it.each([new Error("offline"), null, "missing-slug"])(
  "closes an unused popup after a self-signing failure: %s",
  async (failure) => {
    if (failure === "missing-slug")
      vi.mocked(submissions.createSubmission).mockResolvedValue([]);
    else vi.mocked(submissions.createSubmission).mockRejectedValue(failure);
    const { actions, setIsOpeningSelfSign } = setup();
    await actions.openSelfSigningForm();
    expect(popup.close).toHaveBeenCalledOnce();
    expect(setIsOpeningSelfSign).toHaveBeenLastCalledWith(false);
    expect(toast.error).toHaveBeenCalledWith(
      "Self-signing form could not be opened",
      expect.any(Object),
    );
  },
);
