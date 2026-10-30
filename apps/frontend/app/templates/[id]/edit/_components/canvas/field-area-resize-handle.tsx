"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

export function FieldAreaResizeHandle({
  finishInteraction,
  startResize,
  title,
  updateInteraction,
}: {
  finishInteraction: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  startResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  title: string;
  updateInteraction: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-label={`Resize ${title}`}
      className="absolute -bottom-1.5 -right-1.5 size-3.5 cursor-nwse-resize rounded-full border border-red-500 bg-white shadow-sm ring-2 ring-white transition-transform hover:scale-125"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={startResize}
      onPointerMove={updateInteraction}
      onPointerUp={finishInteraction}
      type="button"
    />
  );
}
