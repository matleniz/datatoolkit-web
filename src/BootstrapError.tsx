import { engineDownHint } from "./bootstrapError";

/** Full-page screen for a failed startup load; the app is not mounted. */
export function BootstrapError({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <main style={{ padding: 24, maxWidth: 640 }}>
      <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>Cannot reach the engine</h1>
      <div className="banner error-banner" role="alert">
        <span>Engine unavailable: {error}</span>
      </div>
      <p style={{ color: "#5b5850", fontSize: 13 }}>
        {engineDownHint(import.meta.env.DEV)}
      </p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </main>
  );
}
