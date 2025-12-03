import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { PocketProvider } from "./contexts/PocketContext.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PocketProvider>
      <App />
    </PocketProvider>
  </StrictMode>,
);
