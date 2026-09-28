import { identityLabel, type DataIdentity } from "../dataIdentity";

/**
 * Version strip for analysis windows (MAT-175): states the exact frame the
 * numbers come from, says when they are being refreshed for a new identity,
 * and — while a step is being edited — that they show the last applied
 * version, not the live preview.
 */
export function IdentityStrip({
  identity,
  shownIdentity,
  editing,
}: {
  identity: DataIdentity;
  /** Identity of the rendered numbers; null while (re)loading. */
  shownIdentity: string | null;
  /** A pending step is live-previewed in the grid (not applied). */
  editing: boolean;
}) {
  const refreshing = shownIdentity !== null && shownIdentity !== identity.key;
  return (
    <div
      className={editing ? "dock-identity editing" : "dock-identity"}
      data-identity-strip="1"
      data-identity-version={identity.version}
      data-identity-role={identity.role}
      data-identity-editing={editing ? "1" : "0"}
    >
      <span className="mono">{identityLabel(identity)}</span>
      {refreshing ? <span className="muted"> · refreshing…</span> : null}
      {editing ? (
        <span className="dock-identity-note">
          {" "}
          · last applied version — the step being edited is not applied yet
        </span>
      ) : null}
    </div>
  );
}
