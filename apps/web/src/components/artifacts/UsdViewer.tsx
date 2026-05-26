/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-namespace */
import React, { useEffect, useRef } from "react";
import Box from "../Box";

interface UsdViewerProps {
  viewConfig: any;
  isFullScreen: boolean;
}

const UsdViewer: React.FC<UsdViewerProps> = ({ viewConfig, isFullScreen }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Dynamically load the model-viewer script if it hasn't been loaded yet
    if (
      !document.querySelector(
        "script[src='https://ajax.googleapis.com/ajax/libs/model-viewer/3.1.1/model-viewer.min.js']",
      )
    ) {
      const script = document.createElement("script");
      script.type = "module";
      script.src = "https://ajax.googleapis.com/ajax/libs/model-viewer/3.1.1/model-viewer.min.js";
      document.head.appendChild(script);
    }
  }, []);

  const modelUrl = viewConfig.url;

  // As requested in the brainstorm: we can use a low-poly version for the feed
  // and full-resolution for full screen, if the backend provides it.
  const lowPolyUrl = viewConfig.low_poly_url || modelUrl;
  const activeUrl = isFullScreen ? modelUrl : lowPolyUrl;

  return (
    <Box
      width="100%"
      height={isFullScreen ? "100%" : "300px"}
      backgroundColor="var(--color-canvas-subtle)"
      position="relative"
    >
      {/* 
        We use React.createElement or dangerouslySetInnerHTML here if TypeScript 
        complains about intrinsic elements, but standard lowercase tags work in React 18 
        for custom web components. 
      */}
      <model-viewer
        src={activeUrl}
        alt="A 3D model"
        auto-rotate
        camera-controls
        ar
        ar-modes="webxr scene-viewer quick-look"
        shadow-intensity="1"
        style={{ width: "100%", height: "100%", backgroundColor: "var(--color-canvas-default)" }}
      ></model-viewer>
    </Box>
  );
};

// Add to TypeScript JSX intrinsic elements so TS doesn't complain
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        alt?: string;
        "auto-rotate"?: boolean;
        "camera-controls"?: boolean;
        ar?: boolean;
        "ar-modes"?: string;
        "shadow-intensity"?: string;
      };
    }
  }
}

export default UsdViewer;
