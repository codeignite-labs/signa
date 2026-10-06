"use client";

import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import type { DocsScreenshot } from "@/lib/docs/screenshots";

export function DocsScreenshotLightbox({
  image,
  onClose,
}: {
  image: DocsScreenshot;
  onClose: () => void;
}) {
  return (
    <Lightbox
      open
      close={onClose}
      slides={[
        {
          src: image.src,
          alt: image.alt,
          width: image.width,
          height: image.height,
        },
      ]}
      plugins={[Zoom]}
      carousel={{ finite: true, preload: 0 }}
      controller={{ aria: true, closeOnBackdropClick: true }}
      portal={{ container: { "aria-label": image.alt } }}
      render={{ buttonPrev: () => null, buttonNext: () => null }}
      className="docs-lightbox"
      zoom={{ maxZoomPixelRatio: 2 }}
    />
  );
}
