/// <reference types="vite/client" />

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
    relayout: (el: HTMLElement, update: object) => Promise<unknown>;
    Plots: { resize: (el: HTMLElement) => Promise<unknown> | void };
  };
  export default Plotly;
}
