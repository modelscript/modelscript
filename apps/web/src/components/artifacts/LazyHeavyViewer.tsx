import { PlayIcon } from "@primer/octicons-react";
import React, { useEffect, useRef, useState } from "react";
import Box from "../Box";

interface LazyHeavyViewerProps {
  artifactId: number;
  thumbnailUrl?: string;
  title?: string;
  children: React.ReactNode;
}

const LazyHeavyViewer: React.FC<LazyHeavyViewerProps> = ({ artifactId, thumbnailUrl, title, children }) => {
  const [isActive, setIsActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={title || "3D View"}
          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "8px" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            color: "rgba(255,255,255,0.7)",
          }}
        >
          <span style={{ fontSize: "14px", fontFamily: "monospace" }}>{title || "Interactive 3D Viewer"}</span>
        </div>
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
          borderRadius: "8px",
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
