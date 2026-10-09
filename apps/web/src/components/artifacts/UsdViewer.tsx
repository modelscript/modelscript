// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-namespace */
import { DownloadIcon, PackageIcon, SyncIcon } from "@primer/octicons-react";
import { Button, IconButton, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import Box from "../Box";

interface UsdViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: var(--color-canvas-default, #0d1117);
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
`;

const Toolbar = styled.div`
  height: 42px;
  min-height: 42px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 10;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.12);
  color: var(--color-accent-amber, #f59e0b);
  border: 1px solid rgba(245, 158, 11, 0.25);
  font-weight: 600;
`;

const FallbackBox = styled.div`
  flex: 1;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--color-canvas-subtle);
  padding: 24px;
  text-align: center;
  gap: 12px;
`;

const UsdViewer: React.FC<UsdViewerProps> = ({ viewConfig, isFullScreen }) => {
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);

  const modelUrl = viewConfig?.url || viewConfig?.modelUrl || viewConfig?.src;
  const lowPolyUrl = viewConfig?.low_poly_url || modelUrl;
  const activeUrl = isFullScreen ? modelUrl : lowPolyUrl;
  const title = viewConfig?.title || (modelUrl ? modelUrl.split("/").pop()?.split("?")[0] : "3D Model Asset");

  useEffect(() => {
    // Check if model-viewer custom element is already registered
    if (window.customElements && window.customElements.get("model-viewer")) {
      setScriptLoaded(true);
      return;
    }

    const scriptSrc = "https://ajax.googleapis.com/ajax/libs/model-viewer/3.1.1/model-viewer.min.js";
    let script = document.querySelector(`script[src='${scriptSrc}']`) as HTMLScriptElement | null;

    if (!script) {
      script = document.createElement("script");
      script.type = "module";
      script.src = scriptSrc;
      script.onload = () => setScriptLoaded(true);
      script.onerror = () => setLoadError(true);
      document.head.appendChild(script);
    } else {
      script.addEventListener("load", () => setScriptLoaded(true));
      script.addEventListener("error", () => setLoadError(true));
    }

    // Timeout safety for airgapped / offline environments
    const timeout = setTimeout(() => {
      if (!window.customElements || !window.customElements.get("model-viewer")) {
        setLoadError(true);
      }
    }, 6000);

    return () => clearTimeout(timeout);
  }, []);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!modelUrl) return;
    const link = document.createElement("a");
    link.href = modelUrl;
    link.download = title || "model.glb";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!modelUrl) {
    return (
      <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="8px">
        <Text color="var(--color-danger-fg)">No 3D model URL provided in artifact configuration.</Text>
      </Box>
    );
  }

  return (
    <Wrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2} overflow="hidden">
          <Badge>
            <PackageIcon size={13} />
            3D-USD/GLTF
          </Badge>
          <Text
            fontWeight="bold"
            fontSize="12.5px"
            color="var(--color-fg-default)"
            style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
          >
            {title}
          </Text>
        </Box>

        <Box display="flex" alignItems="center" gap={1}>
          <Button
            size="small"
            onClick={() => setAutoRotate(!autoRotate)}
            leadingVisual={SyncIcon}
            title="Toggle turntable auto-rotation"
            style={{
              background: autoRotate ? "rgba(245, 158, 11, 0.15)" : undefined,
              borderColor: autoRotate ? "rgba(245, 158, 11, 0.4)" : undefined,
              color: autoRotate ? "#f59e0b" : undefined,
            }}
          >
            {autoRotate ? "Rotating" : "Static"}
          </Button>
          <IconButton
            size="small"
            icon={DownloadIcon}
            aria-label="Download 3D Model"
            title="Download 3D Geometry File"
            onClick={handleDownload}
          />
        </Box>
      </Toolbar>

      {loadError ? (
        <FallbackBox>
          <PackageIcon size={48} fill="var(--color-accent-amber, #f59e0b)" />
          <Text fontWeight="bold" fontSize="14px" color="var(--color-fg-default)">
            3D Model Viewer Offline
          </Text>
          <Text fontSize="12px" color="var(--color-fg-muted)" maxWidth="380px">
            The external WebXR / 3D renderer script could not be loaded (air-gapped or network-restricted environment).
            You can download the model directly to view in Blender, CAD, or local software.
          </Text>
          <Button variant="primary" leadingVisual={DownloadIcon} onClick={handleDownload}>
            Download {title}
          </Button>
        </FallbackBox>
      ) : !scriptLoaded ? (
        <Box flex={1} display="flex" flexDirection="column" alignItems="center" justifyContent="center" gap={2}>
          <Spinner size="medium" />
          <Text fontSize="12.5px" color="var(--color-fg-muted)">
            Initializing 3D renderer...
          </Text>
        </Box>
      ) : (
        <Box flex={1} width="100%" height="100%" position="relative" bg="var(--color-canvas-default)">
          <model-viewer
            src={activeUrl}
            alt={title}
            auto-rotate={autoRotate ? true : undefined}
            camera-controls
            ar
            ar-modes="webxr scene-viewer quick-look"
            shadow-intensity="1"
            style={{ width: "100%", height: "100%", backgroundColor: "var(--color-canvas-default)" }}
          ></model-viewer>
        </Box>
      )}
    </Wrapper>
  );
};

// Add to TypeScript JSX intrinsic elements
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
