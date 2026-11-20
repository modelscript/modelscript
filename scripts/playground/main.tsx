// SPDX-License-Identifier: AGPL-3.0-or-later

import "@modelscript/design-tokens/components.css";
import "@modelscript/design-tokens/tokens.css";
import React from "react";
import { createRoot } from "react-dom/client";
import "../../apps/web/src/index.css";
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
