import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Site from "./Site.tsx";
import { ToastProvider } from "../shared/Toast.tsx";
import "../index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <Site />
    </ToastProvider>
  </StrictMode>,
);
