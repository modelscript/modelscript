/* eslint-disable @typescript-eslint/no-explicit-any */
import { Text } from "@primer/react";
import React from "react";
import Box from "../Box";

interface PictureViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

const PictureViewer: React.FC<PictureViewerProps> = ({ viewConfig, isFullScreen }) => {
  if (!viewConfig.url) {
    return <Text color="var(--color-danger-fg)">No image URL provided.</Text>;
  }

  return (
    <Box
      width="100%"
      height={isFullScreen ? "100%" : "400px"}
      bg="black"
      borderRadius={isFullScreen ? "0" : "8px"}
      overflow="hidden"
      display="flex"
      justifyContent="center"
      alignItems="center"
    >
      <img src={viewConfig.url} alt="Artifact media" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </Box>
  );
};

export default PictureViewer;
