import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { saveAuthSession } from "../../../apps/frontend/lib/api/auth";
import { createRealtimeEventSource } from "../../../apps/frontend/lib/api/realtime";
import { useRealtimeEvents } from "../../../apps/frontend/lib/realtime/use-realtime-events";
import { useUiStore } from "../../../apps/frontend/lib/stores/ui-store";
import {
  getChangedFields,
  hasChangedFields,
  isEqual,
} from "../../../apps/frontend/lib/object-diff";
import * as locale from "../../../apps/frontend/lib/i18n/config";
import { useAppI18n } from "../../../apps/frontend/lib/i18n/use-app-i18n";
class TestEventSource extends EventTarget {
  static instances: TestEventSource[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    super();
    TestEventSource.instances.push(this);
  }
}
function authenticate() {
  saveAuthSession({
    access_token: "test-token",
    user: {
      id: "u",
      email: "u@example.test",
      first_name: null,
      last_name: null,
      role: "admin",
    },
    account: { id: "a", name: "Example", locale: "en-US", timezone: "UTC" },
  });
}
beforeEach(() => {
  TestEventSource.instances = [];
  vi.stubGlobal("EventSource", TestEventSource);
});
it("requires authentication and includes encoded realtime filters in its URL", () => {
  expect(createRealtimeEventSource()).toBeNull();
  authenticate();
  const source = createRealtimeEventSource({
    scope: "template",
    templateId: "template&injected=1",
    submissionId: "submission",
    webhookUrlId: "webhook",
  });
  const url = new URL((source as unknown as TestEventSource).url);
  expect(url.searchParams.get("token")).toBe("test-token");
  expect(url.searchParams.get("template_id")).toBe("template&injected=1");
  expect(url.searchParams.get("injected")).toBeNull();
  expect(url.searchParams.get("scope")).toBe("template");
  expect(url.searchParams.get("submission_id")).toBe("submission");
  expect(url.searchParams.get("webhook_url_id")).toBe("webhook");
  createRealtimeEventSource();
  expect(new URL(TestEventSource.instances[1].url).searchParams.size).toBe(1);
});
it("handles named events, ignores malformed/keepalive messages and uses the latest listener", () => {
  authenticate();
  const first = vi.fn();
  const latest = vi.fn();
  const hook = renderHook(
    ({ onEvent }) => useRealtimeEvents({ onEvent, scope: "account" }),
    { initialProps: { onEvent: first } },
  );
  const source = TestEventSource.instances[0];
  for (const payload of [
    "not json",
    "null",
    "{}",
    '{"type":1}',
    '{"type":"realtime.keepalive"}',
  ])
    source.onmessage?.(new MessageEvent("message", { data: payload }));
  expect(first).not.toHaveBeenCalled();
  const event = {
    type: "template.updated",
    account_id: "a",
    data: {},
    id: "e",
    occurred_at: "",
  };
  source.dispatchEvent(
    new MessageEvent("template.updated", { data: JSON.stringify(event) }),
  );
  expect(first).toHaveBeenCalledWith(event);
  hook.rerender({ onEvent: latest });
  source.onmessage?.(
    new MessageEvent("message", { data: JSON.stringify(event) }),
  );
  expect(latest).toHaveBeenCalledWith(event);
  expect(TestEventSource.instances).toHaveLength(1);
  hook.unmount();
  expect(source.close).toHaveBeenCalledOnce();
});
it("closes the previous stream when scope changes and avoids disabled/unauthenticated subscriptions", () => {
  const noAuth = renderHook(() => useRealtimeEvents({ onEvent: vi.fn() }));
  expect(TestEventSource.instances).toHaveLength(0);
  noAuth.unmount();
  authenticate();
  const hook = renderHook(
    ({ enabled, templateId }) =>
      useRealtimeEvents({ enabled, templateId, onEvent: vi.fn() }),
    { initialProps: { enabled: false, templateId: "1" } },
  );
  expect(TestEventSource.instances).toHaveLength(0);
  hook.rerender({ enabled: true, templateId: "1" });
  hook.rerender({ enabled: true, templateId: "2" });
  expect(TestEventSource.instances[0].close).toHaveBeenCalledOnce();
  hook.unmount();
  expect(TestEventSource.instances[1].close).toHaveBeenCalledOnce();
});
it("keeps independent sidebar and dialog state and supports explicit/toggle updates", () => {
  const store = useUiStore.getState();
  store.setActiveDialog("submission");
  store.setSidebarOpen(false);
  expect(useUiStore.getState()).toMatchObject({
    activeDialog: "submission",
    sidebarOpen: false,
  });
  store.toggleSidebar();
  expect(useUiStore.getState().sidebarOpen).toBe(true);
  store.setActiveDialog(null);
  expect(useUiStore.getState().activeDialog).toBeNull();
});
it("returns only changed form fields for scalar, array, nested and missing values", () => {
  expect(isEqual(NaN, NaN)).toBe(true);
  expect(isEqual(-0, 0)).toBe(false);
  expect(isEqual([1, 2], [1, 2])).toBe(true);
  expect(isEqual([1], [2])).toBe(false);
  expect(isEqual({ a: 1 }, { a: 1 })).toBe(true);
  expect(isEqual(null, {})).toBe(false);
  expect(isEqual("1", 1)).toBe(false);
  expect(isEqual(null, undefined)).toBe(false);
  const initial = {
    name: "A",
    choices: ["a"],
    nested: { enabled: true },
    removed: "old",
  };
  const current = {
    name: "A",
    choices: ["b"],
    nested: { enabled: true },
    removed: undefined as string | undefined,
  };
  expect(getChangedFields(current, initial)).toEqual({
    choices: ["b"],
    removed: undefined as string | undefined,
  });
  expect(hasChangedFields(current, initial)).toBe(true);
  expect(hasChangedFields(initial, { ...initial })).toBe(false);
});
it.each([
  ["fr-FR", "fr"],
  ["FR", "fr"],
  ["sw-KE", "sw"],
  ["ki", "sw"],
  ["unknown", "en"],
  [null, "en"],
  ["", "en"],
] as const)("normalizes locale %s to %s", (input, expected) => {
  expect(locale.normalizeLocale(input)).toBe(expected);
});
it("persists valid locales, updates document language and notifies mounted UI", () => {
  const hook = renderHook(() => useAppI18n());
  expect(hook.result.current.locale).toBe("en");
  act(() => hook.result.current.setLocale("fr"));
  expect(locale.getStoredLocale()).toBe("fr");
  expect(document.documentElement.lang).toBe("fr-FR");
  expect(hook.result.current.locale).toBe("fr");
  expect(hook.result.current.dictionary).toBeTruthy();
  expect(locale.toAccountLocale("sw")).toBe("sw-KE");
  expect(locale.toDocumentLang("en")).toBe("en-US");
  expect(locale.isLocale("fr")).toBe(true);
  expect(locale.isLocale("fr-FR")).toBe(false);
  expect(locale.isLocale(null)).toBe(false);
  hook.unmount();
});
