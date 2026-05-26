/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { VegaEmbed } from "react-vega";
import Box from "../Box";

interface VegaViewerProps {
  viewConfig: any; // expects { spec: any, data?: any }
  isFullScreen?: boolean;
}

const VegaViewer: React.FC<VegaViewerProps> = ({ viewConfig, isFullScreen }) => {
  const [spec, setSpec] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSpec() {
      if (!viewConfig) {
        setError("Missing view config");
        setLoading(false);
        return;
      }

      try {
        let loadedSpec = viewConfig.spec;

        // If spec is a URL path
        if (typeof loadedSpec === "string" && (loadedSpec.startsWith("http") || loadedSpec.startsWith("/"))) {
          const res = await fetch(loadedSpec);
          if (!res.ok) throw new Error("Failed to fetch Vega spec");
          loadedSpec = await res.json();
        }
        // If spec is a JSON string
        else if (typeof loadedSpec === "string") {
          loadedSpec = JSON.parse(loadedSpec);
        }

        if (viewConfig.data) {
          loadedSpec.data = Array.isArray(viewConfig.data) ? { values: viewConfig.data } : viewConfig.data;
        }

        setSpec(loadedSpec);
      } catch (err: any) {
        console.error("Failed to load Vega spec", err);
        setError(err.message || "Failed to load Vega spec");
      } finally {
        setLoading(false);
      }
    }

    loadSpec();
  }, [viewConfig]);

  if (loading) {
    return (
      <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="6px" display="flex" justifyContent="center">
        <Text>Loading plot...</Text>
      </Box>
    );
  }

  if (error || !spec) {
    return (
      <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="6px">
        <Text color="var(--color-danger-fg)">{error || "Invalid Vega specification"}</Text>
      </Box>
    );
  }

  const isVegaLite = spec.$schema && spec.$schema.includes("vega-lite");

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
      <Box style={{ width: "100%", height: "100%", overflowX: "auto", display: "flex", justifyContent: "center" }}>
        <VegaEmbed spec={spec} actions={false} />
      </Box>
    </Box>
  );
};

export default VegaViewer;
