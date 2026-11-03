// SPDX-License-Identifier: AGPL-3.0-or-later

import { register } from "node:module";

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
