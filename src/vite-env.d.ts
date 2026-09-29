/// <reference types="vite/client" />

/** Absolute path to this checkout's `e2e/fixtures` (Vite `define`, MAT-190). */
declare const __DTK_E2E_FIXTURES__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "plotly.js-dist-min" {
  const Plotly: {
    newPlot: (
      el: HTMLElement,
      data: object[],
      layout?: object,
      config?: object,
    ) => Promise<unknown>;
    Plots: { resize: (el: HTMLElement) => Promise<unknown> | void };
  };
  export default Plotly;
}
