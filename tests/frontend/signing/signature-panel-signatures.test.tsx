import React, { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const qr = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("qr-creator", () => ({ default: qr }));
const pad = vi.hoisted(() => ({
  drawn: false,
  clear: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: notifications }));
vi.mock("react-signature-canvas", () => ({
  default: function SignaturePadBoundary({
    canvasProps,
    ref,
  }: {
    canvasProps: React.CanvasHTMLAttributes<HTMLCanvasElement>;
    ref: React.Ref<unknown>;
  }) {
    React.useLayoutEffect(() => {
      pad.drawn = false;
    }, []);
    React.useEffect(() => {
      const clearOnResize = () => {
        pad.drawn = false;
      };
      window.addEventListener("resize", clearOnResize);
      return () => window.removeEventListener("resize", clearOnResize);
    }, []);
    React.useImperativeHandle(ref, () => ({
      isEmpty: () => !pad.drawn,
      toData: () => (pad.drawn ? [[1]] : []),
      clear: () => {
        pad.drawn = false;
        pad.clear();
      },
      getTrimmedCanvas: () => ({
        toDataURL: () => "data:image/png;base64,c2lnbmF0dXJl",
      }),
      fromDataURL: (value: string) => {
        pad.drawn = true;
        pad.restore(value);
      },
    }));
    return <canvas aria-label="Signature canvas" {...canvasProps} />;
  },
}));
import { SignaturePanel } from "../../../apps/frontend/app/s/[slug]/signature-panel";
import type {
  SigningField,
  SigningForm,
  SigningAttachment,
} from "../../../apps/frontend/lib/api/signing";
import { signingForm } from "./signing-fixtures";
const complete = vi.fn().mockResolvedValue(undefined);
const upload = vi.fn().mockResolvedValue("uploaded");
const asset: SigningAttachment = {
  uuid: "saved",
  filename: "saved.png",
  content_type: "image/png",
  url: "/saved.png",
};
function Panel({
  field = { uuid: "signature", type: "signature", name: "Signature" },
  initial,
  useSaved = false,
  assetOverride = asset,
}: {
  field?: SigningField;
  initial?: SigningForm;
  useSaved?: boolean;
  assetOverride?: SigningAttachment;
}) {
  const [form, setForm] = useState(initial ?? signingForm({ fields: [field] }));
  return (
    <SignaturePanel
      activeField={field}
      fields={form.fields}
      form={form}
      onFormChange={setForm}
      onComplete={complete}
      onSaveField={vi.fn()}
      onSelectField={vi.fn()}
      onUploadAttachment={upload}
      savedAssets={
        useSaved
          ? { signature: assetOverride, initials: assetOverride }
          : undefined
      }
    />
  );
}
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}
beforeEach(() => {
  complete.mockClear().mockResolvedValue(undefined);
  upload.mockClear().mockResolvedValue("uploaded");
  notifications.error.mockClear();
  pad.drawn = false;
  pad.clear.mockClear();
  pad.restore.mockClear();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:signature-preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,c2lnbmF0dXJl",
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      async () =>
        new Response("signature", {
          headers: { "Content-Type": "image/png" },
        }),
    ),
  );
});
it("draws, previews, clears, restores and uploads an ordinary signature", async () => {
  render(<Panel />);
  await settle();
  const canvas = await screen.findByLabelText("Signature canvas");
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  expect(complete).not.toHaveBeenCalled();
  pad.drawn = true;
  fireEvent.mouseUp(canvas);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
  fireEvent.click(screen.getByRole("button", { name: "SIGN NOW" }));
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Clear signature" }));
  await settle();
  expect(pad.clear).toHaveBeenCalledOnce();
  pad.drawn = true;
  fireEvent.touchEnd(await screen.findByLabelText("Signature canvas"));
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ type: "signature" }),
      "uploaded",
      {},
    ),
  );
  const [file, type] = upload.mock.calls[0];
  expect(file).toBeInstanceOf(File);
  expect(file.name).toBe("signature.png");
  expect(file.type).toBe("image/png");
  expect(type).toBe("signature");
});
it("uploads a selected initials image and revokes its temporary preview URL", async () => {
  const field = { uuid: "initials", type: "initials", name: "Initials" };
  const view = render(<Panel field={field} />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
  const file = new File(["initials"], "initials.webp", { type: "image/webp" });
  fireEvent.change(view.container.querySelector("input[type=file]")!, {
    target: { files: [file] },
  });
  await settle();
  expect(screen.getByText("initials.webp")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() => expect(upload).toHaveBeenCalledWith(file, "initials"));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:signature-preview");
  expect(complete).toHaveBeenCalledWith(field, "uploaded", {});
});
it("allows clearing an uploaded signature without persisting an empty required value", async () => {
  const view = render(<Panel />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
  const input = view.container.querySelector("input[type=file]")!;
  fireEvent.change(input, {
    target: { files: [new File(["image"], "image.png")] },
  });
  await settle();
  fireEvent.change(input, { target: { files: [] } });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  expect(complete).not.toHaveBeenCalled();
  expect(screen.getByText("Upload a signature image")).toBeTruthy();
});
it("types a signature onto a canvas and saves its PNG attachment", async () => {
  render(<Panel />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Type" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "  Casey Example  " },
  });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ type: "signature" }),
      "uploaded",
      {},
    ),
  );
  const [file, type] = upload.mock.calls[0];
  expect(file.name).toBe("typed-signature.png");
  expect(type).toBe("signature");
  expect(URL.createObjectURL).toHaveBeenCalled();
});
it("clears a typed preview and blocks a blank signature", async () => {
  render(<Panel />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Type" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  expect(complete).not.toHaveBeenCalled();
  expect(notifications.error).toHaveBeenCalledWith(
    "Complete the required field",
    expect.anything(),
  );
});
it("requires a signing reason and includes the reason under its stable field key", async () => {
  const field = { uuid: "signature", type: "signature", name: "Signature" };
  const form = signingForm({ fields: [field] });
  form.configs.require_signing_reason = true;
  render(<Panel field={field} initial={form} useSaved />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith("Signing failed", {
      description: "Enter a signing reason before completing.",
    }),
  );
  fireEvent.change(screen.getByPlaceholderText("Reason for signing"), {
    target: { value: "  Approving this agreement  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith(field, "uploaded", {
      signature_reason: "Approving this agreement",
    }),
  );
});
it("refuses signing reasons without a stable field identifier", async () => {
  const field = { type: "initials", name: "Initials" };
  const form = signingForm({ fields: [field] });
  form.configs.require_signing_reason = true;
  render(<Panel field={field} initial={form} useSaved />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith("Signing failed", {
      description: "Signing reason cannot be saved without a field ID.",
    }),
  );
});
it.each(["Type", "Upload", "Redraw"])(
  "can replace a saved signature using %s",
  async (mode) => {
    render(<Panel useSaved />);
    await settle();
    expect(screen.getByAltText("saved.png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: mode }));
    await settle();
    expect(screen.queryByAltText("saved.png")).toBeNull();
    if (mode === "Type") expect(screen.getByRole("textbox")).toBeTruthy();
    if (mode === "Upload")
      expect(screen.getByText("Upload a signature image")).toBeTruthy();
    if (mode === "Redraw")
      expect(await screen.findByLabelText("Signature canvas")).toBeTruthy();
  },
);
it("surfaces saved signature download failures and leaves the original asset available", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("", { status: 404 })),
  );
  render(<Panel useSaved />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith("Signing failed", {
      description: "Saved signature could not be loaded.",
    }),
  );
  expect(screen.getByAltText("saved.png")).toBeTruthy();
  expect(complete).not.toHaveBeenCalled();
});
it("disables typed signatures when organization policy requires drawing or uploads", async () => {
  const form = signingForm();
  form.configs.with_typed_signature = false;
  render(<Panel initial={form} useSaved />);
  await settle();
  expect(screen.queryByRole("button", { name: "Type" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Redraw" }));
  await settle();
  expect(screen.queryByRole("button", { name: "Type" })).toBeNull();
});

it("receives a signature from a phone, stops polling, and completes without reuploading", async () => {
  vi.stubEnv("NEXT_PUBLIC_SIGNING_BASE_URL", "https://sign.example.test/");
  qr.render.mockClear();
  const interval = vi.spyOn(window, "setInterval");
  const clear = vi.spyOn(window, "clearInterval");
  const remote = {
    uuid: "phone-signature",
    filename: "phone.png",
    content_type: "image/png",
    url: "/phone.png",
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ value: remote.uuid, attachment: remote })),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <Panel
      field={{
        uuid: "signature-long-id",
        type: "signature",
        name: "Signature",
      }}
    />,
  );
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Phone" }));
  await waitFor(() => expect(qr.render).toHaveBeenCalled());
  expect(
    screen
      .getByRole("link", { name: "Open on this device" })
      .getAttribute("href"),
  ).toBe("https://sign.example.test/s/slug?f=signature");
  await act(async () => {
    const poll = interval.mock.calls.find(([, delay]) => delay === 2000)?.[0];
    if (typeof poll === "function") poll();
    await Promise.resolve();
  });
  await screen.findByAltText("phone.png");
  expect(fetchMock.mock.calls[0][0]).toMatch(
    /^\/api\/signing\/slug\/values\?field_uuid=signature-long-id&after=/,
  );
  const pollingIndex = interval.mock.calls.findIndex(
    ([, delay]) => delay === 2000,
  );
  expect(clear).toHaveBeenCalledWith(interval.mock.results[pollingIndex].value);
  complete.mockRejectedValueOnce(new Error("Please retry completion"));
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith("Signing failed", {
      description: "Please retry completion",
    }),
  );
  expect(screen.getByAltText("phone.png")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: "signature-long-id" }),
      "phone-signature",
      {},
    ),
  );
  expect(upload).not.toHaveBeenCalled();
});
it("keeps phone signing open while polling is empty or temporarily fails and lets the signer close it", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const interval = vi.spyOn(window, "setInterval");
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ value: null, attachment: null })),
    )
    .mockRejectedValueOnce(new Error("Temporary network failure"));
  vi.stubGlobal("fetch", fetchMock);
  render(<Panel />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Phone" }));
  await act(async () => {
    const poll = interval.mock.calls.find(([, delay]) => delay === 2000)?.[0];
    if (typeof poll === "function") poll();
    await Promise.resolve();
  });
  await act(async () => {
    const poll = interval.mock.calls.find(([, delay]) => delay === 2000)?.[0];
    if (typeof poll === "function") poll();
    await Promise.resolve();
  });
  expect(log).toHaveBeenCalledWith(expect.any(Error));
  expect(screen.getByLabelText("QR code to sign on phone")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "SAVE AND NEXT" }));
  expect(complete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close phone signing" }));
  expect(await screen.findByLabelText("Signature canvas")).toBeTruthy();
});
it.each([
  ["date", "Date"],
  ["file", "Upload files"],
  ["image", "Upload an image"],
  ["initials", "Initials"],
  ["multiple", "Select options"],
  ["number", "Number"],
  ["payment", "Payment step"],
  ["phone", "Use valid number"],
  ["radio", "Choose option"],
  ["select", "Select option"],
  ["signature", "Signature"],
  ["stamp", "Upload an image"],
  ["text", "Text"],
  ["cells", "Field"],
  [undefined, "Field"],
])("gives an unnamed %s field a readable input label", async (type, label) => {
  const view = render(<Panel field={{ type, required: false }} />);
  await settle();
  if (["text", "number", "cells"].includes(type ?? "") || !type)
    expect(screen.getByPlaceholderText(label!)).toBeTruthy();
  else if (type === "phone")
    expect(screen.getByRole("button", { name: label! })).toBeTruthy();
  else expect(screen.getAllByText(label!).length).toBeGreaterThan(0);
  expect(
    view.container.querySelector('[role="status"]')?.getAttribute("aria-label"),
  ).toBe("Step 1 of 2");
});

it("keeps the cached drawing when the signature canvas clears itself after an orientation resize", async () => {
  render(<Panel />);
  await settle();
  const canvas = await screen.findByLabelText("Signature canvas");
  pad.drawn = true;
  fireEvent.mouseUp(canvas);
  await settle();
  fireEvent(window, new Event("resize"));
  expect(pad.drawn).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() => expect(upload).toHaveBeenCalled());
  expect(complete).toHaveBeenCalledWith(expect.anything(), "uploaded", {});
});
it("starts an anonymous typed signature blank and supports uploads without browser MIME metadata", async () => {
  const field = { uuid: "signature", type: "signature", name: "Signature" };
  const form = signingForm({ fields: [field] });
  form.submitter.name = null;
  const view = render(<Panel field={field} initial={form} />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Type" }));
  expect(screen.getByRole("textbox")).toHaveProperty("value", "");
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
  const file = new File(["image"], "signature.png");
  fireEvent.change(view.container.querySelector("input[type=file]")!, {
    target: { files: [file] },
  });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() => expect(upload).toHaveBeenCalledWith(file, "signature"));
});
it.each(["image/webp", ""])(
  "uses response MIME fallback %s for saved assets with no stored content type",
  async (contentType) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(new Uint8Array([137, 80, 78, 71]), {
              headers: contentType
                ? { "Content-Type": contentType }
                : undefined,
            }),
        ),
    );
    render(<Panel useSaved assetOverride={{ ...asset, content_type: null }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(upload.mock.calls[0][0].type).toBe(contentType || "image/png");
  },
);
