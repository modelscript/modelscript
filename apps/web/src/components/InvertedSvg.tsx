import { invertSvgColors } from "@modelscript/core";
import React, { useEffect, useReducer, useRef } from "react";
import { useTheme } from "../theme";

interface InvertedSvgProps {
  src: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  style?: React.CSSProperties;
  onLoad?: () => void;
  onError?: (e: unknown) => void;
}

type State = { svgContent: string | null; error: boolean };
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

/**
 * Renders an SVG inline with Helmlab-based perceptual color inversion
 * for dark mode. Falls back to hiding on error.
 */
const InvertedSvg: React.FC<InvertedSvgProps> = ({ src, alt, width, height, style, onLoad, onError }) => {
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
    return null;
  }

  const isDark = theme === "dark";
  const processed = invertSvgColors(state.svgContent, isDark);

  return (
    <div
      role="img"
      aria-label={alt}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width,
        height,
        flexShrink: 0,
        ...style,
      }}
      dangerouslySetInnerHTML={{ __html: processed }}
    />
  );
};

export default InvertedSvg;
