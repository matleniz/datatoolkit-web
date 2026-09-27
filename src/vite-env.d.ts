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
  };
  export default Plotly;
}
