import type { DragEvent } from "react";

import type { Attachments } from "./useAttachments";

/** Props that make an element a drop target for files. */
export function dropProps(attachments: Attachments) {
  return {
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      if (e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      attachments.addFiles(Array.from(e.dataTransfer.files));
    },
  };
}
