// SPDX-License-Identifier: AGPL-3.0-or-later

import "@modelscript/design-tokens/components.css";
import "@modelscript/design-tokens/tokens.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

import { setConsoleFunction } from "three";

// Suppress upstream THREE.Clock deprecation warning from @react-three/fiber until R3F migrates to THREE.Timer
if (typeof setConsoleFunction === "function") {
  setConsoleFunction((type: string, message: unknown, ...params: unknown[]) => {
    if (
      type === "warn" &&
      typeof message === "string" &&
      (message.includes("Clock: This module has been deprecated") || message.includes("THREE.Clock"))
    ) {
      return;
    }
    if (type === "log") {
      console.log(message, ...params);
    } else if (type === "error") {
      console.error(message, ...params);
    } else {
      console.warn(message, ...params);
    }
  });
}

if (typeof window !== "undefined" && !(window as any).__threeClockWarningFilterInstalled__) {
  (window as any).__threeClockWarningFilterInstalled__ = true;
  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      (args[0].includes("THREE.Clock: This module has been deprecated") ||
        args[0].includes("Clock: This module has been deprecated"))
    ) {
      return;
    }
    originalWarn(...args);
  };
}

// Suppress benign Monaco internal cancellation errors (e.g. WordHighlighter / Delayer cancellation on model swap)
if (typeof window !== "undefined" && !(window as any).__monacoCancellationFilterInstalled__) {
  (window as any).__monacoCancellationFilterInstalled__ = true;
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (
      reason &&
      (reason.name === "Canceled" ||
        reason.message === "Canceled" ||
        reason.name === "CancellationError" ||
        (typeof reason.message === "string" && reason.message.includes("Canceled")))
    ) {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[PWA] Service worker registration failed:", err);
    });
  });
}
