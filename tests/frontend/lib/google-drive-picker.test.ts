import { beforeEach, afterEach, expect, it, vi } from "vitest";
let picker: typeof import("../../../apps/frontend/lib/google-drive/picker");
let tokenReply: { access_token?: string; error?: string };
let pickerReply: Record<string, unknown>;
let tokenCallback: (reply: typeof tokenReply) => void;
let chosen: ((reply: Record<string, unknown>) => void) | undefined;
const visible = vi.fn();
const requestAccessToken = vi.fn();
class PickerView {
  setIncludeFolders = vi.fn(() => this);
  setSelectFolderEnabled = vi.fn(() => this);
  setMimeTypes = vi.fn(() => this);
}
class PickerBuilder {
  setAppId = vi.fn(() => this);
  setDeveloperKey = vi.fn(() => this);
  setOAuthToken = vi.fn(() => this);
  enableFeature = vi.fn(() => this);
  addView = vi.fn(() => this);
  setCallback(callback: (reply: Record<string, unknown>) => void) {
    chosen = callback;
    return this;
  }
  build() {
    return { setVisible: visible };
  }
}
function config() {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID", "client");
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_PICKER_API_KEY", "key");
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_PICKER_APP_ID", "app");
}
function createLoadedScripts(loaded = true) {
  for (const src of [
    "https://accounts.google.com/gsi/client",
    "https://apis.google.com/js/api.js",
  ]) {
    const script = document.createElement("script");
    script.src = src;
    if (loaded) script.dataset.loaded = "true";
    document.head.appendChild(script);
  }
}
beforeEach(async () => {
  vi.resetModules();
  config();
  tokenReply = { access_token: "access" };
  pickerReply = {
    action: "picked",
    documents: [
      { id: "one", name: "Agreement", mimeType: "application/pdf" },
      { name: "missing id" },
    ],
  };
  requestAccessToken.mockImplementation(() =>
    queueMicrotask(() => tokenCallback(tokenReply)),
  );
  visible.mockImplementation(() => queueMicrotask(() => chosen?.(pickerReply)));
  window.gapi = { load: vi.fn((_library, callback) => callback()) };
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: vi.fn((input) => {
          tokenCallback = input.callback;
          return { callback: input.callback, requestAccessToken };
        }),
      },
    },
    picker: {
      Action: { CANCEL: "cancel", PICKED: "picked" },
      DocsView: PickerView,
      Feature: { MULTISELECT_ENABLED: "multi" },
      PickerBuilder,
      Response: { ACTION: "action", DOCUMENTS: "documents" },
      ViewId: { DOCS: "docs" },
    },
  };
  picker = await import("../../../apps/frontend/lib/google-drive/picker");
});
afterEach(() => {
  delete window.google;
  delete window.gapi;
  document.head
    .querySelectorAll('script[src*="google.com"]')
    .forEach((script) => script.remove());
});
it("requires all Google picker configuration values without opening scripts", async () => {
  expect(picker.isGoogleDrivePickerConfigured()).toBe(true);
  for (const name of [
    "NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID",
    "NEXT_PUBLIC_GOOGLE_PICKER_API_KEY",
    "NEXT_PUBLIC_GOOGLE_PICKER_APP_ID",
  ]) {
    config();
    vi.stubEnv(name, "");
    expect(picker.isGoogleDrivePickerConfigured()).toBe(false);
    await expect(picker.pickGoogleDriveDocuments()).rejects.toThrow(
      "Google Drive is not configured",
    );
  }
});
it("opens a multiselect picker with consent and maps only documents with identifiers", async () => {
  createLoadedScripts();
  const result = await picker.pickGoogleDriveDocuments();
  expect(result).toEqual({
    accessToken: "access",
    files: [{ id: "one", name: "Agreement", mime_type: "application/pdf" }],
  });
  expect(requestAccessToken).toHaveBeenCalledWith({ prompt: "consent" });
  expect(window.google?.accounts?.oauth2?.initTokenClient).toHaveBeenCalledWith(
    expect.objectContaining({
      client_id: "client",
      scope: expect.stringContaining("drive.file"),
    }),
  );
  expect(visible).toHaveBeenCalledWith(true);
  await picker.pickGoogleDriveDocuments();
  expect(window.gapi?.load).toHaveBeenCalledTimes(1);
});
it.each([
  { action: "cancel" },
  { action: "picked" },
  { action: "picked", docs: [{ id: "fallback" }] },
])("handles cancelled or fallback picker results %j", async (reply) => {
  createLoadedScripts();
  pickerReply = reply;
  const result = await picker.pickGoogleDriveDocuments();
  expect(result.files).toEqual(
    "docs" in reply
      ? [{ id: "fallback", mime_type: undefined, name: undefined }]
      : [],
  );
});
it("ignores intermediate picker actions until the user makes a selection", async () => {
  createLoadedScripts();
  visible.mockImplementation(() =>
    queueMicrotask(() => {
      chosen?.({ action: "loading" });
      chosen?.({ action: "picked", documents: [] });
    }),
  );
  expect((await picker.pickGoogleDriveDocuments()).files).toEqual([]);
});
it.each([{ error: "access_denied" }, {}])(
  "rejects denied or absent access tokens %j",
  async (reply) => {
    createLoadedScripts();
    tokenReply = reply;
    await expect(picker.pickGoogleDriveDocuments()).rejects.toThrow(
      "error" in reply ? "access_denied" : "Google Drive access was denied",
    );
  },
);
it("reports missing Identity Services and missing Picker exports", async () => {
  createLoadedScripts();
  delete window.google!.accounts;
  await expect(picker.pickGoogleDriveDocuments()).rejects.toThrow(
    "Google Identity Services could not be loaded",
  );
  vi.resetModules();
  picker = await import("../../../apps/frontend/lib/google-drive/picker");
  delete window.google!.picker;
  await expect(picker.pickGoogleDriveDocuments()).rejects.toThrow(
    "Google Picker could not be loaded",
  );
});
it("reports Picker being unavailable after authorization", async () => {
  createLoadedScripts();
  requestAccessToken.mockImplementation(() => {
    delete window.google!.picker;
    tokenCallback({ access_token: "access" });
  });
  await expect(picker.pickGoogleDriveDocuments()).rejects.toThrow(
    "Google Picker could not be loaded",
  );
});
it("loads new scripts asynchronously once and reuses script elements still being loaded", async () => {
  const appendChild = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation((element) => {
    const result = appendChild(element);
    if (element instanceof HTMLScriptElement)
      queueMicrotask(() => element.dispatchEvent(new Event("load")));
    return result;
  });
  await picker.pickGoogleDriveDocuments();
  expect(
    document.head.querySelectorAll('script[data-loaded="true"]'),
  ).toHaveLength(2);
  vi.resetModules();
  picker = await import("../../../apps/frontend/lib/google-drive/picker");
  document.head
    .querySelectorAll<HTMLScriptElement>("script")
    .forEach((script) => {
      delete script.dataset.loaded;
    });
  const pending = picker.pickGoogleDriveDocuments();
  document.head
    .querySelectorAll("script")
    .forEach((script) => script.dispatchEvent(new Event("load")));
  await expect(pending).resolves.toMatchObject({ accessToken: "access" });
});
it("rejects script loading failures", async () => {
  const appendChild = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation((element) => {
    const result = appendChild(element);
    if (element instanceof HTMLScriptElement)
      queueMicrotask(() => element.dispatchEvent(new Event("error")));
    return result;
  });
  await expect(picker.pickGoogleDriveDocuments()).rejects.toThrow(
    "Failed to load https://accounts.google.com/gsi/client",
  );
});
