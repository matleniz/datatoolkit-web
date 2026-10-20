import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { Bootstrap } from "./Bootstrap";
import { ErrorBoundary } from "./ErrorBoundary";
import { AppProvider } from "./state/AppStore";
import "./theme/tokens.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root missing");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <Bootstrap>
          <App />
        </Bootstrap>
      </AppProvider>
    </ErrorBoundary>
  </StrictMode>,
);
