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
  if (textMatches && textMatches.some((t) => t.replace(/<[^>]+>/g, "").trim().length > 0)) return true;
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

const SvgContainer = styled.div<{ $w: number | string; $h: number | string }>`
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
  }

  & svg rect:first-of-type[width="200"][height="200"],
  & svg > g > rect:first-child[width="200"][height="200"] {
    rx: 22px;
    ry: 22px;
  }

  & svg path:not([fill]),
  & svg polyline:not([fill]),
  & svg line:not([fill]) {
    fill: none !important;
  }

  & svg path,
  & svg polyline,
  & svg line {
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  & svg [stroke-width="0.25"] {
    stroke-width: 1.5px;
  }
  & svg [stroke-width="0.5"],
  & svg [stroke-width="1"] {
    stroke-width: 1.75px;
  }

  & svg [stroke="#c0c0c0"],
  & svg [stroke="#c8c8c8"] {
    stroke: #94a3b8;
  }
  & svg [fill="#c0c0c0"],
  & svg [fill="#c8c8c8"] {
    fill: #94a3b8;
  }
`;

/**
 * Renders an SVG inline with Helmlab-based perceptual color inversion
 * for dark mode. Falls back to hiding on error.
 */
const InvertedSvg: React.FC<InvertedSvgProps> = ({ src, alt, width, height, style, fallback, onLoad, onError }) => {
  const { theme } = useTheme();
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

    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
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

  const isDark = theme === "dark";
  const processed = invertSvgColors(state.svgContent, isDark);
  const sanitized = DOMPurify.sanitize(processed, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });

  return (
    <SvgContainer
      role="img"
      aria-label={alt}
      $w={width || "100%"}
      $h={height || "auto"}
      style={style}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
};

export default InvertedSvg;
