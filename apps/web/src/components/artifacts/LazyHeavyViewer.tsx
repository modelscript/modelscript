// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalContextPool } from "@modelscript/embed";
import { PlayIcon } from "@primer/octicons-react";
import { useTheme } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import Box from "../Box";
import ArtifactPlaceholder from "./ArtifactPlaceholder";

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

  useEffect(() => {
    if (isFullScreen) {
      setIsActive(true);
    }
  }, [isFullScreen]);

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
      captureSnapshot: () => {
        const canvas = containerRef.current?.querySelector("canvas");
        if (canvas) {
          try {
            return canvas.toDataURL("image/webp", 0.85);
          } catch {
            return null;
          }
        }
        return null;
      },
    });

    return () => {
      globalContextPool.release(id);
    };
  }, [isActive, isFullScreen, artifactId]);

  const defaultThumbnailUrl =
    resolvedColorMode === "dark" ? thumbnailUrlDark || thumbnailUrl : thumbnailUrlLight || thumbnailUrl;
  const currentThumbnailUrl = frozenSnapshot || defaultThumbnailUrl;

  // Handle global mutual exclusion
  useEffect(() => {
    const handleActivate = (e: Event) => {
      const activeId = (e as CustomEvent<number>).detail;
      if (activeId !== artifactId && !isFullScreen) {
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
            // Unload when it goes out of view
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

  const containerHeight = isFullScreen ? "100%" : "420px";

  if (isActive || isFullScreen) {
    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          maxWidth: "100%",
          height: containerHeight,
          minHeight: isFullScreen ? "420px" : undefined,
          position: "relative",
          overflow: "hidden",
          boxSizing: "border-box",
          borderRadius: isFullScreen ? "0" : "8px",
        }}
      >
        {/* Floating Deactivate / Sleep Button */}
        {!isFullScreen && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsActive(false);
            }}
            style={{
              position: "absolute",
              top: 12,
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
        borderRadius: "8px",
      }}
    >
      {currentThumbnailUrl ? (
        <img
          src={currentThumbnailUrl}
          alt={title || "3D View"}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderTopLeftRadius: "8px",
            borderTopRightRadius: "8px",
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
          }}
        />
      ) : (
        <ArtifactPlaceholder type={placeholderType} title={title} height="100%" />
      )}

      {/* Play button overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          borderTopLeftRadius: "8px",
          borderTopRightRadius: "8px",
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
        }}
        onClick={() => {
          setIsActive(true);
          window.dispatchEvent(new CustomEvent("activate-3d-viewer", { detail: artifactId }));
        }}
      >
        {frozenSnapshot ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              borderRadius: 24,
              background: "rgba(13, 17, 23, 0.88)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid rgba(6, 182, 212, 0.4)",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4), 0 0 12px rgba(6, 182, 212, 0.25)",
              color: "#f0f6fc",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font-mono, monospace)",
              transition: "transform 0.2s ease, border-color 0.2s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            <span style={{ fontSize: 16 }}>🧊</span>
            <span>Click to re-activate 3D</span>
            <PlayIcon size={14} fill="#06b6d4" />
          </div>
        ) : (
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            bg="rgba(0,0,0,0.7)"
            borderRadius="50%"
            style={{ width: 64, height: 64, transition: "transform 0.2s ease", color: "white" }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.1)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            <PlayIcon size={32} />
          </Box>
        )}
      </div>
    </div>
  );
};

export default LazyHeavyViewer;
