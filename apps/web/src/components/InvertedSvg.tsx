// SPDX-License-Identifier: AGPL-3.0-or-later

import { invertSvgColors } from "@modelscript/diagram";
import DOMPurify from "dompurify";
import React, { useEffect, useReducer, useRef } from "react";
import styled from "styled-components";
import { useTheme } from "../theme";

interface InvertedSvgProps {
  src: string;
  alt?: string | undefined;
  width?: number | string | undefined;
  height?: number | string | undefined;
  style?: React.CSSProperties | undefined;
  fallback?: React.ReactNode | undefined;
  onLoad?: (() => void) | undefined;
  onError?: ((e: unknown) => void) | undefined;
}

interface State {
  svgContent: string | null;
  error: boolean;
}
type Action = { type: "reset" } | { type: "loaded"; content: string } | { type: "failed" };

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return { svgContent: null, error: false };
    case "loaded":
      return { svgContent: action.content, error: false };
    case "failed":
      return { svgContent: null, error: true };
  }
}

function stripAllHtmlTags(input: string): string {
  let prev = "";
  let curr = input;
  while (curr !== prev) {
    prev = curr;
    curr = curr.replace(/<[^>]*>/g, "");
  }
  return curr;
}

function hasDistinctGraphics(svg: string): boolean {
  if (
    svg.includes('viewBox="0 0 120 80"') ||
    svg.includes("«") ||
    svg.includes('viewBox="0 0 680 240"') ||
    svg.includes("specializes ")
  )
    return false;
  if (/<(line|circle|path|polygon|polyline|ellipse|image)\b/i.test(svg)) return true;
  if (/url\(#/i.test(svg)) return true;
  const textMatches = svg.match(/<text\b[^>]*>([\s\S]*?)<\/text>/gi);
  if (textMatches && textMatches.some((t) => stripAllHtmlTags(t).trim().length > 0)) return true;
  const rectMatches = svg.match(/<rect\b[^>]*>/gi);
  if (rectMatches) {
    const hasVisualRect = rectMatches.some(
      (r) => /\b(rx|ry)\s*=\s*"[^0]/i.test(r) || /fill="url\(#/i.test(r) || /stroke="(?!none)[^"]+"/i.test(r),
    );
    if (hasVisualRect) return true;
    const nonBackgroundRects = rectMatches.filter((r) => {
      const is200 = /width="200(?:\.0+)?"/i.test(r) && /height="200(?:\.0+)?"/i.test(r);
      return !is200;
    });
    if (nonBackgroundRects.length > 0) return true;
  }
  return false;
}

function getNumericSize(dim: number | string | undefined): number | null {
  if (typeof dim === "number") return dim;
  if (typeof dim === "string") {
    const m = dim.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i);
    if (m) return parseFloat(m[1]!);
  }
  return null;
}

/**
 * Normalizes Modelica SVGs before inline injection:
 * 1. Scopes all `id="..."` and `url(#...)` / `href="#..."` attributes to `instanceId`
 *    so multiple inline SVGs in the document never collide on `<defs>` gradients/markers.
 * 2. Fixes legacy `<text>` elements that were generated with a stroke or without auto-sized `font-size`.
 */
function normalizeModelicaSvg(svg: string, instanceId: string): string {
  let out = svg;

  // 1. Fix legacy <text> elements with <tspan> and missing font-size
  out = out.replace(
    /<text\b([^>]*)>\s*<tspan\b[^>]*>([\s\S]*?)<\/tspan>\s*<\/text>/gi,
    (fullMatch, attrsStr: string, innerText: string) => {
      const text = innerText.trim();
      if (!text) return "";
      const hasFontSize = /\bfont-size\s*=/i.test(attrsStr);
      if (hasFontSize) return fullMatch;

      const isHidden = /\bvisibility\s*=\s*"hidden"/i.test(attrsStr);
      const wMatch = attrsStr.match(/\bwidth="([-\d.]+)"/i);
      const hMatch = attrsStr.match(/\bheight="([-\d.]+)"/i);
      const xMatch = attrsStr.match(/\bx="([-\d.]+)"/i);
      const yMatch = attrsStr.match(/\by="([-\d.]+)"/i);
      const fillMatch = attrsStr.match(/\bfill="([^"]+)"/i);
      const anchorMatch = attrsStr.match(/\btext-anchor="([^"]+)"/i);

      const w = wMatch ? parseFloat(wMatch[1]!) : 100;
      const h = hMatch ? parseFloat(hMatch[1]!) : 60;
      const x = xMatch ? parseFloat(xMatch[1]!) : -w / 2;
      const y = yMatch ? parseFloat(yMatch[1]!) : -h / 2;
      const fill = fillMatch ? fillMatch[1]! : "#000000";
      const anchor = anchorMatch ? anchorMatch[1]! : "middle";

      const cx = anchor === "start" ? x : anchor === "end" ? x + w : x + w / 2;
      const cy = y + h / 2;
      const charCount = Math.max(text.length, 1);
      const fontSize = Math.round(Math.max(Math.min(w / (charCount * 0.6), h) * 0.9, 4) * 100) / 100;
      const visAttr = isHidden ? ' visibility="hidden"' : "";

      return `<text x="${cx}" y="${cy}" fill="${fill}" font-family="sans-serif" font-size="${fontSize}" dominant-baseline="central" text-anchor="${anchor === "start" && !anchorMatch ? "middle" : anchor}"${visAttr}>${text}</text>`;
    },
  );

  // 2. Scope all id="..." and url(#...) references to prevent DOM collisions across icons
  const ids = new Set<string>();
  const idRegex = /\bid="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = idRegex.exec(out)) !== null) {
    if (match[1]) ids.add(match[1]);
  }
  if (ids.size > 0) {
    for (const id of ids) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const scopedId = `${instanceId}_${id}`;
      out = out.replace(new RegExp(`\\bid="${escaped}"`, "g"), `id="${scopedId}"`);
      out = out.replace(new RegExp(`url\\(#${escaped}\\)`, "g"), `url(#${scopedId})`);
      out = out.replace(new RegExp(`href="#${escaped}"`, "g"), `href="#${scopedId}"`);
    }
  }

  return out;
}

const SvgContainer = styled.div<{ $w: number | string; $h: number | string; $thinStroke: number; $baseStroke: number }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${(p) => (typeof p.$w === "number" ? `${p.$w}px` : p.$w)};
  height: ${(p) => (typeof p.$h === "number" ? `${p.$h}px` : p.$h)};
  flex-shrink: 0;
  line-height: 0;
  border-radius: 4px;

  & > svg {
    width: 100%;
    height: 100%;
    display: block;
    max-width: 100%;
    max-height: 100%;
    border-radius: inherit;
    overflow: hidden;
  }

  & svg path:not([fill]),
  & svg polyline:not([fill]),
  & svg line:not([fill]) {
    fill: none !important;
  }

  & svg text {
    stroke: none !important;
  }

  & svg path,
  & svg polyline,
  & svg line {
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  & svg [stroke-width="0.25"] {
    stroke-width: ${(p) => p.$thinStroke}px;
  }
  & svg [stroke-width="0.5"],
  & svg [stroke-width="1"] {
    stroke-width: ${(p) => p.$baseStroke}px;
  }
`;

const svgFetchCache = new Map<string, Promise<string>>();

function fetchSvgCached(url: string): Promise<string> {
  const existing = svgFetchCache.get(url);
  if (existing) return existing;
  const promise = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .catch((err) => {
      svgFetchCache.delete(url);
      throw err;
    });
  svgFetchCache.set(url, promise);
  return promise;
}

/**
 * Renders an SVG inline with Helmlab-based perceptual color inversion
 * for dark mode. Falls back to hiding on error.
 */
const InvertedSvg: React.FC<InvertedSvgProps> = ({ src, alt, width, height, style, fallback, onLoad, onError }) => {
  const { theme } = useTheme();
  const rawInstanceId = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [state, dispatch] = useReducer(reducer, { svgContent: null, error: false });

  // Keep callback refs stable so they don't need to be in the dep array
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "reset" });

    fetchSvgCached(src)
      .then((text) => {
        if (cancelled) return;
        if (
          !text ||
          !text.trim() ||
          text.includes("«") ||
          text.includes('viewBox="0 0 680 240"') ||
          text.includes("specializes ")
        ) {
          dispatch({ type: "failed" });
          onErrorRef.current?.(new Error("Empty or synthetic diagram content"));
          return;
        }
        dispatch({ type: "loaded", content: text });
        onLoadRef.current?.();
      })
      .catch((err) => {
        if (cancelled) return;
        dispatch({ type: "failed" });
        onErrorRef.current?.(err);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (state.error || state.svgContent === null) {
    return fallback ? <>{fallback}</> : null;
  }

  if (fallback && !hasDistinctGraphics(state.svgContent)) {
    return <>{fallback}</>;
  }

  if (state.svgContent.includes('viewBox="0 0 120 80"')) {
    return fallback ? <>{fallback}</> : null;
  }

  const numericSize = getNumericSize(width) ?? getNumericSize(height);
  let thinStroke = 1.25;
  let baseStroke = 1.5;
  if (numericSize !== null) {
    if (numericSize <= 20) {
      thinStroke = 0.65;
      baseStroke = 0.8;
    } else if (numericSize <= 36) {
      thinStroke = 0.85;
      baseStroke = 1.0;
    } else if (numericSize <= 64) {
      thinStroke = 1.0;
      baseStroke = 1.15;
    }
  }

  const isDark = theme === "dark";
  const normalized = normalizeModelicaSvg(state.svgContent, `ms_${rawInstanceId}`);
  const processed = invertSvgColors(normalized, isDark);
  const sanitized = DOMPurify.sanitize(processed, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });

  return (
    <SvgContainer
      role="img"
      aria-label={alt}
      $w={width || "100%"}
      $h={height || "auto"}
      $thinStroke={thinStroke}
      $baseStroke={baseStroke}
      style={style}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
};

export default InvertedSvg;
