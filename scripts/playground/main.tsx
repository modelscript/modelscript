// SPDX-License-Identifier: AGPL-3.0-or-later

import "@modelscript/design-tokens/tokens-web.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { PlaygroundApp } from "./playground-app.js";
import "./playground-styles.css";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <PlaygroundApp />
    </React.StrictMode>,
  );
}
