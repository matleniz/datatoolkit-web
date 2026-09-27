import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { AppProvider } from "./state/AppStore";
import { emptyWorkspace } from "./state/reducer";
import "./theme/tokens.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root missing");
}

createRoot(root).render(
  <StrictMode>
    <AppProvider initial={{ workspace: emptyWorkspace("churn") }}>
      <App />
    </AppProvider>
  </StrictMode>,
);
