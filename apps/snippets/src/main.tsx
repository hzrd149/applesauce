import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { PocketProvider } from "./contexts/PocketContext.tsx";
import "./services/loaders.ts";

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PocketProvider>
      <App />
    </PocketProvider>
  </StrictMode>,
);
