/* eslint-disable @typescript-eslint/no-explicit-any */
import { Text } from "@primer/react";
import React from "react";
import Box from "../Box";

interface ModelicaDiagramViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

const ModelicaDiagramViewer: React.FC<ModelicaDiagramViewerProps> = ({ viewConfig, isFullScreen }) => {
  return (
    <Box
      p={isFullScreen ? 0 : 3}
      backgroundColor={isFullScreen ? "black" : "white"}
      borderRadius={isFullScreen ? "0" : "6px"}
      border={isFullScreen ? "none" : "1px solid var(--color-border)"}
      display="flex"
      alignItems="center"
      justifyContent="center"
      height={isFullScreen ? "100%" : "200px"}
    >
      {viewConfig.thumbnail_url ? (
        <img
          src={viewConfig.thumbnail_url}
          alt="Modelica Diagram"
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
            if (e.currentTarget.nextElementSibling) {
              e.currentTarget.nextElementSibling.removeAttribute("hidden");
            }
          }}
        />
      ) : null}
      <Text color="var(--color-fg-muted)" hidden={!!viewConfig.thumbnail_url}>
        [Interactive Modelica Diagram Placeholder]
      </Text>
    </Box>
  );
};

export default ModelicaDiagramViewer;
