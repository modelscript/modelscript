/* eslint-disable @typescript-eslint/no-explicit-any */
import { Text } from "@primer/react";
import React from "react";
import Box from "../Box";

interface PdfViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

const PdfViewer: React.FC<PdfViewerProps> = ({ viewConfig, isFullScreen }) => {
  if (!viewConfig.url) {
    return <Text color="var(--color-danger-fg)">No PDF URL provided.</Text>;
  }

  // Use a native iframe to render the PDF. The #toolbar=0 hides the browser's default PDF toolbar
  // which provides a cleaner embedded look in the timeline.
  return (
    <Box
      width="100%"
      height={isFullScreen ? "100%" : "500px"}
      bg="var(--color-canvas-subtle)"
      borderRadius={isFullScreen ? "0" : "8px"}
      overflow="hidden"
    >
      <iframe
        src={`${viewConfig.url}#toolbar=0`}
        width="100%"
        height="100%"
        style={{ border: "none" }}
        title="PDF Document"
      />
    </Box>
  );
};

export default PdfViewer;
