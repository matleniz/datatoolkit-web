/**
 * Absolute filesystem path to this repo's `e2e/fixtures` directory.
 * Injected at build/dev time via Vite `define` so engine file paths stay
 * relative to the current checkout (MAT-190) instead of a hard-coded worktree.
 */
declare const __DTK_E2E_FIXTURES__: string;

export const E2E_FIXTURES_DIR: string = __DTK_E2E_FIXTURES__;
