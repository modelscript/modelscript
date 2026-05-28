import { PlayIcon } from "@primer/octicons-react";
import { useTheme } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import Box from "../Box";

interface LazyHeavyViewerProps {
  artifactId: number;
  thumbnailUrl?: string;
  thumbnailUrlLight?: string;
  thumbnailUrlDark?: string;
  title?: string;
  placeholderType?: "fea" | "cfd" | "cad" | "pdf" | "generic";
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
      <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
        {children}
      </div>
    );
  }

  // Render thumbnail / load button
  return (
    <div ref={containerRef} style={{ width: "100%", height: "450px", position: "relative" }}>
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
        <img
          src={`/placeholders/${placeholderType}_${resolvedColorMode === "dark" ? "dark" : "light"}.png`}
          alt={title || "Placeholder"}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderTopLeftRadius: "8px",
            borderTopRightRadius: "8px",
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            filter: "brightness(0.7) blur(2px)",
          }}
        />
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
