/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import Box from "../Box";

interface SimulationPlotViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

const SimulationPlotViewer: React.FC<SimulationPlotViewerProps> = ({ viewConfig, isFullScreen }) => {
  return (
    <Box
      p={isFullScreen ? 0 : 3}
      backgroundColor="var(--color-canvas-default)"
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: isFullScreen ? "100%" : "150px",
        height: isFullScreen ? "100%" : "auto",
      }}
    >
      <GraphIcon size={32} fill="var(--color-accent-emphasis)" />
      <Box mt={3} textAlign="center">
        <Text display="block" fontWeight="bold">
          Parametric Simulation Plot
        </Text>
        <Text display="block" color="var(--color-fg-muted)" fontSize="12px">
          Model: {viewConfig.model || "Unknown"}
        </Text>
        {viewConfig.overrides && (
          <Box
            mt={2}
            fontSize="12px"
            fontFamily="monospace"
            backgroundColor="var(--color-canvas-subtle)"
            p={2}
            borderRadius="6px"
          >
            {Object.entries(viewConfig.overrides).map(([k, v]) => (
              <div key={k}>
                {k} = {String(v)}
              </div>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default SimulationPlotViewer;
