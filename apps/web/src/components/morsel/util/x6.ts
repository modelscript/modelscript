// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  adaptColorForDarkMode,
  adaptSvgColors,
  adaptX6Markup,
  invertColorHelmlab,
  invertSvgColors,
} from "@modelscript/dsl/utils";

export { adaptColorForDarkMode, adaptSvgColors, adaptX6Markup, invertColorHelmlab, invertSvgColors };

/**
 * Normalizes an SVG string for rendering inside an icon container (e.g. ComponentList, Tree):
 * - Uses standard DOMParser / XMLSerializer when available (in all browsers)
 * - Directly sets width="100%", height="100%", and overflow/sizing styles on the SVGSVGElement DOM node
 * - Completely avoids regex replacements on SVG markup to eliminate accidental child-node mutations
 */
export function normalizeSvgForIcon(svgStr: string): string {
  if (!svgStr || !svgStr.includes("<svg")) return svgStr;

  let DOMParserCtor: typeof DOMParser | undefined = typeof DOMParser !== "undefined" ? DOMParser : undefined;
  let XMLSerializerCtor: typeof XMLSerializer | undefined =
    typeof XMLSerializer !== "undefined" ? XMLSerializer : undefined;

  // Node.js test environment fallback: lazy load jsdom if DOMParser is not globally available
  if (!DOMParserCtor) {
    try {
      const jsdom =
        (globalThis as any).jsdom ||
        (typeof (globalThis as any).require !== "undefined" ? (globalThis as any).require("jsdom") : undefined);
      if (jsdom) {
        const dom = new jsdom.JSDOM("");
        DOMParserCtor = dom.window.DOMParser;
        XMLSerializerCtor = dom.window.XMLSerializer;
      }
    } catch {
      // skip
    }
  }

  if (DOMParserCtor && XMLSerializerCtor) {
    try {
      const parser = new DOMParserCtor();
      const doc = parser.parseFromString(svgStr, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (svg && !doc.querySelector("parsererror")) {
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        const existingStyle = svg.getAttribute("style") || "";
        svg.setAttribute("style", `overflow: hidden; max-width: 100%; max-height: 100%; ${existingStyle}`.trim());
        return new XMLSerializerCtor().serializeToString(svg);
      }
    } catch {
      // Fall through if DOMParser threw
    }
  }

  // Pure structural fallback without inner regex: extract only the opening <svg ...> tag
  const match = svgStr.match(/^[\s\S]*?(<svg\b[^>]*>)/i);
  if (!match || !match[1]) return svgStr;
  const originalTag = match[1];

  // Parse attributes of the root tag only using an XML attribute parser
  const attrsStr = originalTag.slice("<svg".length, -1);
  const keptAttrs: string[] = [];
  let existingStyle = "";
  const attrRegex = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(["'])([\s\S]*?)\2)?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(attrsStr)) !== null) {
    const name = m[1]!.toLowerCase();
    if (name === "width" || name === "height") continue;
    if (name === "style") {
      existingStyle = m[3] ?? "";
      continue;
    }
    keptAttrs.push(m[0]!);
  }

  const mergedStyle = `overflow: hidden; max-width: 100%; max-height: 100%; ${existingStyle}`.trim();
  const newTag = `<svg width="100%" height="100%" style="${mergedStyle}" ${keptAttrs.join(" ")}>`;
  return svgStr.replace(originalTag, newTag);
}
