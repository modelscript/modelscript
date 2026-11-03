// SPDX-License-Identifier: AGPL-3.0-or-later

import { register } from "node:module";
import React from "react";

// Provide React on globalThis for node:test runner environments where TSX transforms JSX to React.createElement
(globalThis as any).React = React;

const cssLoaderCode = `
export function load(url, context, nextLoad) {
  if (url.endsWith(".css") || url.includes(".css?")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export default {};",
    };
  }
  return nextLoad(url, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(cssLoaderCode)}`);
