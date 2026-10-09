// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon } from "@primer/octicons-react";
import { useTheme } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import Box from "../Box";
import ArtifactPlaceholder from "./ArtifactPlaceholder";

interface LazyHeavyViewerProps {
  artifactId: number;
  thumbnailUrl?: string;
  thumbnailUrlLight?: string;
  thumbnailUrlDark?: string;
  title?: string;
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
    | string;
  children: React.ReactNode;
}

const LazyHeavyViewer: React.FC<LazyHeavyViewerProps> = ({
  artifactId,
  thumbnailUrl,
  thumbnailUrlLight,
  thumbnailUrlDark,
  title,
  placeholderType = "generic",
  children,
}) => {
  const [isActive, setIsActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedColorMode } = useTheme();

  const currentThumbnailUrl =
    resolvedColorMode === "dark" ? thumbnailUrlDark || thumbnailUrl : thumbnailUrlLight || thumbnailUrl;

  // Handle global mutual exclusion
  useEffect(() => {
    const handleActivate = (e: Event) => {
      const activeId = (e as CustomEvent<number>).detail;
      if (activeId !== artifactId) {
        setIsActive(false);
      }
    };
    window.addEventListener("activate-3d-viewer", handleActivate);
    return () => window.removeEventListener("activate-3d-viewer", handleActivate);
  }, [artifactId]);

  // Handle intersection observer to unload on scroll out
  useEffect(() => {
    if (!isActive) return;

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
  }, [isActive]);

  if (isActive) {
    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          maxWidth: "100%",
          height: "420px",
          position: "relative",
          overflow: "hidden",
          boxSizing: "border-box",
          borderRadius: "8px",
        }}
      >
        {/* Floating Deactivate / Sleep Button */}
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
        height: "420px",
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
      </div>
    </div>
  );
};

export default LazyHeavyViewer;
