import type { RegisteredAttachment } from "./attachmentContract";

export interface AttachDeps {
  upload(file: File): Promise<{ path: string }>;
  register(path: string): Promise<RegisteredAttachment>;
  detach(serverId: string): Promise<void>;
}

/** `ready`: show the chip; `dropped`: the chip was removed meanwhile, nothing stays attached. */
export type AttachOutcome = { kind: "ready"; attachment: RegisteredAttachment } | { kind: "dropped" };

/**
 * Upload, then register with the session (datatoolkit-issues#128). A chip
 * removed while uploading must not stay readable by the agent: it is not
 * registered if removed before the upload ends, and detached if removed
 * while the registration was in flight.
 */
export async function attachFile(
  file: File,
  isRemoved: () => boolean,
  deps: AttachDeps,
): Promise<AttachOutcome> {
  const { path } = await deps.upload(file);
  if (isRemoved()) return { kind: "dropped" };
  const attachment = await deps.register(path);
  if (isRemoved()) {
    await deps.detach(attachment.id);
    return { kind: "dropped" };
  }
  return { kind: "ready", attachment };
}
