/* eslint-disable @typescript-eslint/no-explicit-any */
import { Text } from "@primer/react";
import React from "react";
import Box from "../Box";

interface AudioViewerProps {
  viewConfig: any;
}

const AudioViewer: React.FC<AudioViewerProps> = ({ viewConfig }) => {
  if (!viewConfig.url) {
    return <Text color="var(--color-danger-fg)">No audio URL provided.</Text>;
  }

  return (
    <Box
      width="100%"
      p={3}
      bg="var(--color-canvas-subtle)"
      borderRadius="8px"
      display="flex"
      justifyContent="center"
      alignItems="center"
    >
      <audio controls autoPlay src={viewConfig.url} style={{ width: "100%" }} />
    </Box>
  );
};

export default AudioViewer;
