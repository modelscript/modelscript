/* eslint-disable @typescript-eslint/no-explicit-any */
import { Text } from "@primer/react";
import React from "react";
import Box from "../Box";

interface ModelicaCodeViewerProps {
  viewConfig: any;
}

const ModelicaCodeViewer: React.FC<ModelicaCodeViewerProps> = ({ viewConfig }) => {
  return (
    <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="6px">
      <Text style={{ fontFamily: "monospace", whiteSpace: "pre-wrap", fontSize: "12px" }}>
        {viewConfig.code || "model Unknown\nend Unknown;"}
      </Text>
    </Box>
  );
};

export default ModelicaCodeViewer;
