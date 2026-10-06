"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { ExpandIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocsScreenshot as Screenshot } from "@/lib/docs/screenshots";

const ScreenshotLightbox = dynamic(
  () =>
    import("./docs-screenshot-lightbox").then(
      (module) => module.DocsScreenshotLightbox,
    ),
  { ssr: false },
);

export function DocsScreenshot({ image }: { image: Screenshot }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  function closeViewer() {
    setOpen(false);
  }
  useEffect(() => {
    if (!open) trigger.current?.focus();
  }, [open]);
  return (
    <figure className="mt-7 flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl border border-border bg-card">
        <button
          type="button"
          aria-label={`Enlarge screenshot: ${image.alt}`}
          aria-haspopup="dialog"
          onClick={(event) => {
            trigger.current = event.currentTarget;
            setOpen(true);
          }}
          className="block w-full cursor-zoom-in rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <Image
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            sizes="(min-width: 1280px) 700px, (min-width: 1024px) 65vw, 100vw"
            className="h-auto w-full"
          />
        </button>
        <Button
          variant="secondary"
          size="sm"
          onClick={(event) => {
            trigger.current = event.currentTarget;
            setOpen(true);
          }}
          aria-label={`Enlarge screenshot: ${image.alt}`}
          className="absolute bottom-3 right-3"
        >
          <ExpandIcon data-icon="inline-start" />
          Enlarge
        </Button>
      </div>
      <figcaption className="text-sm leading-6 text-muted-foreground">
        {image.caption}
      </figcaption>
      {open && <ScreenshotLightbox image={image} onClose={closeViewer} />}
    </figure>
  );
}
