// SPDX-License-Identifier: AGPL-3.0-or-later

import { register } from "node:module";
import React from "react";

// Provide React on globalThis for node:test runner environments where TSX transforms JSX to React.createElement
(globalThis as any).React = React;

const cssLoaderCode = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "styled-components" && !context.parentURL?.startsWith("data:")) {
    const resolved = await nextResolve(specifier, context);
    const shimCode = [
      "import sc from " + JSON.stringify(resolved.url) + ";",
      "const styled = sc.default ?? sc;",
      "if (typeof styled === 'function' && !styled.default) { styled.default = styled; }",
      "export default styled;",
      "export const css = sc.css ?? styled.css;",
      "export const keyframes = sc.keyframes ?? styled.keyframes;",
      "export const createGlobalStyle = sc.createGlobalStyle ?? styled.createGlobalStyle;",
      "export const ThemeProvider = sc.ThemeProvider ?? styled.ThemeProvider;",
      "export const StyleSheetManager = sc.StyleSheetManager ?? styled.StyleSheetManager;",
      "export const useTheme = sc.useTheme ?? styled.useTheme;",
      "export const isStyledComponent = sc.isStyledComponent ?? styled.isStyledComponent;",
      "export const ServerStyleSheet = sc.ServerStyleSheet ?? styled.ServerStyleSheet;",
      "export const withTheme = sc.withTheme ?? styled.withTheme;",
    ].join("\\n");
    return {
      shortCircuit: true,
      url: "data:text/javascript," + encodeURIComponent(shimCode),
    };
  }
  if (specifier.startsWith("@antv/")) {
    const shimCode = "export class Graph {}; export const Cell = {}; export const Node = {}; export const Edge = {}; export default { Graph, Cell, Node, Edge };";
    return {
      shortCircuit: true,
      url: "data:text/javascript," + encodeURIComponent(shimCode),
    };
  }
  return nextResolve(specifier, context);
}

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
