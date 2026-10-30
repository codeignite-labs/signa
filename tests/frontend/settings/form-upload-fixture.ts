import { beforeEach, vi } from "vitest";
const NativeFormData = FormData;
beforeEach(() => {
  // jsdom serialization does not use files assigned by fireEvent.change.
  vi.stubGlobal(
    "FormData",
    class extends NativeFormData {
      constructor(form?: HTMLFormElement) {
        super(form);
        for (const input of form?.querySelectorAll<HTMLInputElement>(
          "input[type=file][name]",
        ) ?? []) {
          const file = input.files?.[0];
          if (file) this.set(input.name, file, file.name);
        }
      }
    },
  );
});
