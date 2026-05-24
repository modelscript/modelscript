/* eslint-disable @typescript-eslint/no-explicit-any */
import { Text } from "@primer/react";
import React from "react";
import Box from "../Box";

interface VideoViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

const VideoViewer: React.FC<VideoViewerProps> = ({ viewConfig, isFullScreen }) => {
  if (!viewConfig.url) {
    return <Text color="var(--color-danger-fg)">No video URL provided.</Text>;
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
      <video controls autoPlay src={viewConfig.url} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </Box>
  );
};

export default VideoViewer;
