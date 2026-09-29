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
  compact = false,
}: {
  identity: DataIdentity;
  /** Identity of the rendered numbers; null while (re)loading. */
  shownIdentity: string | null;
  /** A pending step is live-previewed in the grid (not applied). */
  editing: boolean;
  /** Compact chip format for analysis window sub-chrome (MAT-246). */
  compact?: boolean;
}) {
  const refreshing = shownIdentity !== null && shownIdentity !== identity.key;
  const full = identityLabel(identity);
  const label = compact
    ? `${identity.role}·${identity.version === 0 ? "src" : `v${identity.version}`}`
    : full;

  return (
    <div
      className={editing ? "dock-identity editing" : "dock-identity"}
      data-identity-strip="1"
      data-identity-version={identity.version}
      data-identity-role={identity.role}
      data-identity-editing={editing ? "1" : "0"}
      title={editing ? `${full} (last applied version)` : full}
    >
      <span className="mono dock-identity-label">{label}</span>
      {refreshing ? <span className="muted" title="refreshing…">…</span> : null}
      {editing ? (
        <span className="dock-identity-note">
          {" "}
          · last applied version — the step being edited is not applied yet
        </span>
      ) : null}
    </div>
  );
}
