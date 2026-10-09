// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { DownloadIcon, EyeIcon, FileMediaIcon, SyncIcon } from "@primer/octicons-react";
import { Button, IconButton, Text } from "@primer/react";
import React, { useRef, useState } from "react";
import styled from "styled-components";
import Box from "../Box";
import type { AnySpatialPin, SpatialPin2D } from "./spatial-pin";

interface PictureViewerProps {
  viewConfig: any; // expects { url: string, title?: string }
  isFullScreen?: boolean;
  onPinCreated?: (pin: AnySpatialPin) => void;
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
  background: rgba(16, 185, 129, 0.12);
  color: var(--color-accent-emerald, #10b981);
  border: 1px solid rgba(16, 185, 129, 0.25);
  font-weight: 600;
`;

const InfoBadge = styled.span`
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  color: var(--color-fg-muted, #8b949e);
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
`;

const CanvasViewport = styled.div<{ $isDragging: boolean; $isPinMode: boolean }>`
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  background: #05080f;
  cursor: ${(props) => (props.$isPinMode ? "crosshair" : props.$isDragging ? "grabbing" : "grab")};
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const ImageTransformLayer = styled.div<{
  $zoom: number;
  $panX: number;
  $panY: number;
  $isInverted: boolean;
}>`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(${(props) => props.$panX}px, ${(props) => props.$panY}px) scale(${(props) => props.$zoom});
  transform-origin: center center;
  transition: ${(props) =>
    props.$zoom === 1 && props.$panX === 0 && props.$panY === 0 ? "transform 0.2s ease" : "none"};

  img {
    max-width: 95%;
    max-height: 95%;
    object-fit: contain;
    filter: ${(props) =>
      props.$isInverted
        ? "invert(0.92) hue-rotate(180deg) contrast(1.15) drop-shadow(0 4px 14px rgba(0, 0, 0, 0.5))"
        : "drop-shadow(0 4px 14px rgba(0, 0, 0, 0.5))"};
    image-rendering: ${(props) => (props.$zoom > 2.5 ? "pixelated" : "auto")};
    pointer-events: none;
  }
`;

const PictureViewer: React.FC<PictureViewerProps> = ({ viewConfig, isFullScreen, onPinCreated }) => {
  const url = viewConfig?.url || viewConfig?.src;
  const title = viewConfig?.title || (url ? url.split("/").pop()?.split("?")[0] : "Technical Drawing");

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isInverted, setIsInverted] = useState(false);
  const [isPinMode, setIsPinMode] = useState(false);
  const [pins, setPins] = useState<SpatialPin2D[]>([]);
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });

  if (!url) {
    return (
      <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="8px">
        <Text color="var(--color-danger-fg)">No image URL provided in artifact configuration.</Text>
      </Box>
    );
  }

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (isPinMode) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
      const xFraction = Number((x / rect.width).toFixed(4));
      const yFraction = Number((y / rect.height).toFixed(4));

      const newPin: SpatialPin2D = {
        coord: [xFraction, yFraction],
        label: `Annotation #${pins.length + 1} (${Math.round(xFraction * 100)}%, ${Math.round(yFraction * 100)}%)`,
        fieldName: title,
        metadata: naturalDimensions || undefined,
      };

      setPins((prev) => [...prev, newPin]);
      onPinCreated?.(newPin);
      setIsPinMode(false);
      return;
    }

    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    setZoom((prev) => Math.min(Math.max(0.2, prev * factor), 8.0));
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleDoubleClick = () => {
    if (zoom !== 1) {
      handleResetZoom();
    } else {
      setZoom(2);
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = document.createElement("a");
    link.href = url;
    link.download = title || "schematic_drawing.png";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Wrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2} overflow="hidden">
          <Badge>
            <FileMediaIcon size={13} />
            DRAWING
          </Badge>
          <Text
            fontWeight="bold"
            fontSize="12.5px"
            color="var(--color-fg-default)"
            style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
          >
            {title}
          </Text>
          {naturalDimensions && (
            <InfoBadge>
              {naturalDimensions.width} × {naturalDimensions.height} px
            </InfoBadge>
          )}
          <InfoBadge>{Math.round(zoom * 100)}%</InfoBadge>
        </Box>

        <Box display="flex" alignItems="center" gap={1}>
          <Button
            size="small"
            onClick={() => setZoom((z) => Math.max(0.2, z * 0.85))}
            title="Zoom Out"
            style={{ padding: "3px 8px" }}
          >
            −
          </Button>
          <Button
            size="small"
            onClick={() => setZoom((z) => Math.min(8.0, z * 1.15))}
            title="Zoom In"
            style={{ padding: "3px 8px" }}
          >
            +
          </Button>
          {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
            <IconButton
              size="small"
              icon={SyncIcon}
              aria-label="Reset View"
              title="Reset Zoom & Pan"
              onClick={handleResetZoom}
            />
          )}
          <Button
            size="small"
            leadingVisual={EyeIcon}
            onClick={() => setIsInverted((prev) => !prev)}
            title="Toggle color inversion (white-background schematic to dark mode)"
            style={{
              background: isInverted ? "rgba(16, 185, 129, 0.2)" : undefined,
              borderColor: isInverted ? "rgba(16, 185, 129, 0.4)" : undefined,
              color: isInverted ? "#10b981" : undefined,
            }}
          >
            {isInverted ? "Inverted" : "Invert"}
          </Button>
          <Button
            size="small"
            onClick={() => setIsPinMode(!isPinMode)}
            title="Click image to drop an annotation pin for discussion"
            style={{
              background: isPinMode ? "rgba(168, 85, 247, 0.25)" : undefined,
              borderColor: isPinMode ? "rgba(168, 85, 247, 0.4)" : undefined,
              color: isPinMode ? "#a855f7" : undefined,
            }}
          >
            📍 {isPinMode ? "Click Image" : "Pin"}
          </Button>
          <IconButton
            size="small"
            icon={DownloadIcon}
            aria-label="Download Image"
            title="Download Original Image"
            onClick={handleDownload}
          />
        </Box>
      </Toolbar>

      <CanvasViewport
        $isDragging={isDragging}
        $isPinMode={isPinMode}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      >
        <ImageTransformLayer $zoom={zoom} $panX={pan.x} $panY={pan.y} $isInverted={isInverted}>
          <img src={url} alt={title} onLoad={handleImageLoad} />
        </ImageTransformLayer>

        {/* 2D Spatial Pin Markers */}
        {pins.map((pin, idx) => (
          <div
            key={idx}
            style={{
              position: "absolute",
              left: `${pin.coord[0] * 100}%`,
              top: `${pin.coord[1] * 100}%`,
              transform: "translate(-50%, -100%)",
              pointerEvents: "none",
              zIndex: 10,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "20px", filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.85))" }}>📍</span>
            <span
              style={{
                background: "rgba(14, 20, 36, 0.95)",
                color: "#38bdf8",
                fontSize: "10.5px",
                fontFamily: "var(--font-mono, monospace)",
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: "4px",
                border: "1px solid rgba(56, 189, 248, 0.4)",
                whiteSpace: "nowrap",
                marginTop: "-4px",
              }}
            >
              #{idx + 1}
            </span>
          </div>
        ))}
      </CanvasViewport>
    </Wrapper>
  );
};

export default PictureViewer;
