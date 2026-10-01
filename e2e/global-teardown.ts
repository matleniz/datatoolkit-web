import { rmSync } from "node:fs";

export default async function globalTeardown(): Promise<void> {
  if (process.env.DTK_E2E_KEEP === "1") {
    return;
  }
  const dtkHome = process.env.DTK_E2E_HOME;
  if (dtkHome) {
    rmSync(dtkHome, { recursive: true, force: true });
  }
}
