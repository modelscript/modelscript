// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalContextPool } from "@modelscript/embed";
import { PlayIcon } from "@primer/octicons-react";
import { useTheme } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import Box from "../Box";
import ArtifactPlaceholder from "./ArtifactPlaceholder";
import { captureCompositeCanvasDataUrl } from "./AutoThumbnailCapture";

interface LazyHeavyViewerProps {
  artifactId: number;
  thumbnailUrl?: string | undefined;
  thumbnailUrlLight?: string | undefined;
  thumbnailUrlDark?: string | undefined;
  title?: string | undefined;
  isFullScreen?: boolean | undefined;
  placeholderType?:
    | "fea"
    | "cfd"
    | "cad"
    | "pdf"
    | "gcode"
    | "fmu"
    | "sysml"
    | "dataset"
    | "plot"
    | "webgpu"
    | "generic"
    | string
    | undefined;
  children: React.ReactNode;
}

export const THUMBNAIL_RADIAL_GREY_LIGHT = "radial-gradient(circle at center, #cdced0 0%, #d6d7d9 50%, #e2e3e4 100%)";
export const THUMBNAIL_RADIAL_GREY_DARK = "radial-gradient(circle at center, #2b2e36 0%, #1f2229 55%, #14161b 100%)";
export const THUMBNAIL_RADIAL_GREY_BG = THUMBNAIL_RADIAL_GREY_LIGHT;

export function getThumbnailRadialBg(colorMode?: string): string {
  return colorMode === "dark" ? THUMBNAIL_RADIAL_GREY_DARK : THUMBNAIL_RADIAL_GREY_LIGHT;
}

const LazyHeavyViewer: React.FC<LazyHeavyViewerProps> = ({
  artifactId,
  thumbnailUrl,
  thumbnailUrlLight,
  thumbnailUrlDark,
  title,
  isFullScreen = false,
  placeholderType = "generic",
  children,
}) => {
  const [isActive, setIsActive] = useState(isFullScreen);
  const [frozenSnapshot, setFrozenSnapshot] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedColorMode } = useTheme();
  const radialBg = getThumbnailRadialBg(resolvedColorMode);

  const captureCanvasSnapshot = (): string | null => {
    const canvas = containerRef.current?.querySelector("canvas");
    return captureCompositeCanvasDataUrl(canvas);
  };

  useEffect(() => {
    if (isFullScreen) {
      setIsActive(true);
    }
  }, [isFullScreen]);

  // Listen for AutoThumbnailCapture snapshots so client state updates immediately without requiring page reload
  useEffect(() => {
    const handleCaptured = (e: Event) => {
      const detail = (e as CustomEvent<{ artifactId: number; dataUrl: string }>).detail;
      if (detail && detail.artifactId === artifactId && detail.dataUrl) {
        setFrozenSnapshot(detail.dataUrl);
      }
    };
    window.addEventListener("artifact-thumbnail-captured", handleCaptured);
    return () => window.removeEventListener("artifact-thumbnail-captured", handleCaptured);
  }, [artifactId]);

  // Context pooling integration
  useEffect(() => {
    if (!isActive || isFullScreen) {
      globalContextPool.release(`artifact-${artifactId}`);
      return;
    }

    const id = `artifact-${artifactId}`;
    globalContextPool.requestActive({
      id,
      onSleep: (snapshot) => {
        if (!isFullScreen) {
          if (snapshot) {
            setFrozenSnapshot(snapshot);
          }
          setIsActive(false);
        }
      },
      captureSnapshot: () => captureCanvasSnapshot(),
    });

    return () => {
      globalContextPool.release(id);
    };
  }, [isActive, isFullScreen, artifactId]);

  const defaultThumbnailUrl =
    resolvedColorMode === "dark" ? thumbnailUrlDark || thumbnailUrl : thumbnailUrlLight || thumbnailUrl;
  const currentThumbnailUrl = frozenSnapshot || defaultThumbnailUrl;

  // Missing/404 thumbnails fall back to the placeholder instead of a broken <img>.
  const [failedThumbnailUrl, setFailedThumbnailUrl] = useState<string | null>(null);
  const isDefaultThumbnailFailed = Boolean(defaultThumbnailUrl) && failedThumbnailUrl === defaultThumbnailUrl;
  const showThumbnail = Boolean(currentThumbnailUrl) && failedThumbnailUrl !== currentThumbnailUrl;

  // Handle global mutual exclusion
  useEffect(() => {
    const handleActivate = (e: Event) => {
      const activeId = (e as CustomEvent<number>).detail;
      if (activeId !== artifactId && !isFullScreen) {
        const snap = captureCanvasSnapshot();
        if (snap) setFrozenSnapshot(snap);
        setIsActive(false);
      }
    };
    window.addEventListener("activate-3d-viewer", handleActivate);
    return () => window.removeEventListener("activate-3d-viewer", handleActivate);
  }, [artifactId, isFullScreen]);

  // Handle intersection observer to unload on scroll out
  useEffect(() => {
    if (!isActive || isFullScreen) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            // Capture snapshot before unloading when it goes out of view
            const snap = captureCanvasSnapshot();
            if (snap) setFrozenSnapshot(snap);
            setIsActive(false);
          }
        });
      },
      { threshold: 0.0 },
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [isActive, isFullScreen]);

  const containerHeight = isFullScreen ? "100%" : "450px";

  if (isActive || isFullScreen) {
    return (
      <div
        ref={containerRef}
        data-thumbnail-failed={isDefaultThumbnailFailed ? "true" : undefined}
        style={{
          width: "100%",
          maxWidth: "100%",
          height: containerHeight,
          minHeight: isFullScreen ? "450px" : undefined,
          position: "relative",
          overflow: "hidden",
          boxSizing: "border-box",
          borderRadius: 0,
          background: radialBg,
        }}
      >
        {/* Floating Deactivate / Sleep Button */}
        {!isFullScreen && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const snap = captureCanvasSnapshot();
              if (snap) setFrozenSnapshot(snap);
              setIsActive(false);
            }}
            style={{
              position: "absolute",
              top: 52,
              right: 12,
              zIndex: 20,
              display: "flex",
              alignItems: "center",
              gap: "5px",
              background: "rgba(15, 23, 42, 0.8)",
              backdropFilter: "blur(10px)",
              color: "#e2e8f0",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: "16px",
              padding: "3px 10px",
              fontSize: "11px",
              fontWeight: 600,
              fontFamily: "var(--font-mono, monospace)",
              cursor: "pointer",
              boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(239, 68, 68, 0.85)";
              e.currentTarget.style.color = "#ffffff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(15, 23, 42, 0.8)";
              e.currentTarget.style.color = "#e2e8f0";
            }}
            title="Release 3D canvas and return to preview thumbnail"
          >
            ✕ Sleep 3D
          </button>
        )}
        {children}
      </div>
    );
  }

  // Render thumbnail / load button
  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        maxWidth: "100%",
        height: containerHeight,
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
        borderRadius: 0,
        background: radialBg,
      }}
    >
      {showThumbnail ? (
        <img
          src={currentThumbnailUrl}
          alt={title || "3D View"}
          onError={() => setFailedThumbnailUrl(currentThumbnailUrl ?? null)}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "contain",
            borderRadius: 0,
          }}
        />
      ) : (
        <ArtifactPlaceholder type={placeholderType} title={title} height="100%" />
      )}

      {/* Interactive 3D launch overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          borderRadius: 0,
        }}
        onClick={() => {
          setIsActive(true);
          window.dispatchEvent(new CustomEvent("activate-3d-viewer", { detail: artifactId }));
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 18px",
            borderRadius: 9999,
            background: "rgba(13, 17, 23, 0.86)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(56, 189, 248, 0.45)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4), 0 0 14px rgba(56, 189, 248, 0.22)",
            color: "#f8fafc",
            fontSize: 12.5,
            fontWeight: 600,
            fontFamily: "var(--font-mono, monospace)",
            transition: "transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.05)";
            e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.8)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.45)";
          }}
        >
          <Box
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            borderRadius="50%"
            style={{
              width: 22,
              height: 22,
              background: "rgba(56, 189, 248, 0.2)",
              color: "#38bdf8",
            }}
          >
            <PlayIcon size={12} />
          </Box>
          <span>{frozenSnapshot ? "Click to re-activate 3D" : "Interact in 3D"}</span>
        </div>
      </div>
    </div>
  );
};

export default LazyHeavyViewer;
