/* eslint-disable @typescript-eslint/no-explicit-any */
import { Text } from "@primer/react";
import mermaid from "mermaid";
import React, { useEffect, useRef, useState } from "react";
import Box from "../Box";

interface MermaidViewerProps {
  viewConfig: any; // expects { code: string }
  isFullScreen?: boolean;
}

const MermaidViewer: React.FC<MermaidViewerProps> = ({ viewConfig, isFullScreen }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCode() {
      if (viewConfig?.codeUrl) {
        try {
          const res = await fetch(viewConfig.codeUrl);
          if (!res.ok) throw new Error("Failed to fetch Mermaid code");
          const text = await res.text();
          setCode(text);
        } catch (err: any) {
          setError(err.message || "Failed to fetch Mermaid code");
        }
      } else if (viewConfig?.code) {
        setCode(viewConfig.code);
      }
    }
    fetchCode();
  }, [viewConfig]);

  useEffect(() => {
    if (!code || !containerRef.current) return;

    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "loose",
    });

    const renderMermaid = async () => {
      try {
        setError(null);
        // Add a random ID to prevent collisions if multiple diagrams exist
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        const { svg } = await mermaid.render(id, code);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err: any) {
        console.error("Mermaid rendering failed:", err);
        setError(err.message || "Failed to render Mermaid diagram");
      }
    };

    renderMermaid();
  }, [code]);

  if (!viewConfig || (!viewConfig.code && !viewConfig.codeUrl)) {
    return (
      <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="6px">
        <Text color="var(--color-danger-fg)">Invalid Mermaid configuration</Text>
      </Box>
    );
  }

  return (
    <Box
      p={isFullScreen ? 0 : 3}
      backgroundColor="var(--color-canvas-default)"
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: isFullScreen ? "100%" : "300px",
        height: isFullScreen ? "100%" : "auto",
        width: "100%",
        overflow: "hidden",
      }}
    >
      {error ? (
        <Text color="var(--color-danger-fg)">{error}</Text>
      ) : (
        <div
          ref={containerRef}
          style={{ width: "100%", height: "100%", overflowX: "auto", display: "flex", justifyContent: "center" }}
        />
      )}
    </Box>
  );
};

export default MermaidViewer;
