// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, EyeIcon, FileMediaIcon, SyncIcon } from "@primer/octicons-react";
import { Button, IconButton, Text } from "@primer/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { sanitizeHttpUrl } from "../../util/url";
import Box from "../Box";
import type { AnySpatialPin, SpatialPin2D } from "./spatial-pin";
import { useWheelZoom, ZoomHintBadge } from "./useArtifactZoom";

interface PictureViewerProps {
  viewConfig: any; // expects { url: string, title?: string, pins?: SpatialPin2D[] }
  isFullScreen?: boolean | undefined;
  onPinCreated?: ((pin: AnySpatialPin) => void) | undefined;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean | undefined }>`
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
  background: var(--color-canvas-subtle, #161b22);
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
  color: var(--color-fg-muted, #57606a);
  background: var(--color-neutral-muted, rgba(175, 184, 193, 0.2));
  border: 1px solid var(--color-border-muted, rgba(175, 184, 193, 0.2));
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
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
  $rotation: number;
}>`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(${(props) => props.$panX}px, ${(props) => props.$panY}px) scale(${(props) => props.$zoom})
    rotate(${(props) => props.$rotation}deg);
  transform-origin: center center;
  transition: ${(props) =>
    props.$zoom === 1 && props.$panX === 0 && props.$panY === 0 ? "transform 0.2s ease" : "none"};
`;

const ImageStageWrapper = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  max-width: 95%;
  max-height: 95%;
`;

const StyledImage = styled.img<{ $zoom: number; $isInverted: boolean }>`
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  filter: ${(props) =>
    props.$isInverted
      ? "invert(0.92) hue-rotate(180deg) contrast(1.15) drop-shadow(0 4px 14px rgba(0, 0, 0, 0.5))"
      : "drop-shadow(0 4px 14px rgba(0, 0, 0, 0.5))"};
  image-rendering: ${(props) => (props.$zoom > 2.5 ? "pixelated" : "auto")};
  pointer-events: none;
`;

function parseInitialPins(raw: unknown): SpatialPin2D[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is SpatialPin2D =>
    Boolean(
      p &&
      typeof p === "object" &&
      Array.isArray((p as SpatialPin2D).coord) &&
      (p as SpatialPin2D).coord.length === 2 &&
      typeof (p as SpatialPin2D).coord[0] === "number" &&
      typeof (p as SpatialPin2D).coord[1] === "number",
    ),
  );
}

const PictureViewer: React.FC<PictureViewerProps> = ({ viewConfig, isFullScreen, onPinCreated }) => {
  const url = sanitizeHttpUrl(viewConfig?.url || viewConfig?.src, { allowRelative: true });
  const title = viewConfig?.title || (url ? url.split("/").pop()?.split("?")[0] : "Technical Drawing");

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isInverted, setIsInverted] = useState(false);
  const [isPinMode, setIsPinMode] = useState(false);
  const [pins, setPins] = useState<SpatialPin2D[]>(() => parseInitialPins(viewConfig?.pins));
  const [activePinIndex, setActivePinIndex] = useState<number | null>(null);
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null);
  const [imageError, setImageError] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const cleanupDragListenersRef = useRef<(() => void) | null>(null);

  const prevUrlRef = useRef<string | undefined>(url);

  // Reset viewer state when URL changes
  useEffect(() => {
    if (prevUrlRef.current !== url) {
      prevUrlRef.current = url;
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setRotation(0);
      setIsInverted(false);
      setIsPinMode(false);
      setPins(parseInitialPins(viewConfig?.pins));
      setActivePinIndex(null);
      setNaturalDimensions(null);
      setImageError(false);
    }
  }, [url, viewConfig?.pins]);

  const endDrag = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
    if (cleanupDragListenersRef.current) {
      cleanupDragListenersRef.current();
      cleanupDragListenersRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (cleanupDragListenersRef.current) {
        cleanupDragListenersRef.current();
        cleanupDragListenersRef.current = null;
      }
    };
  }, []);

  const { showHint } = useWheelZoom({
    containerRef: viewportRef,
    zoom,
    setZoom,
    pan,
    setPan,
    isFullScreen,
    minZoom: 0.2,
    maxZoom: 8.0,
  });

  if (!url) {
    return (
      <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="8px">
        <Text color="var(--color-danger-fg)">No image URL provided in artifact configuration.</Text>
      </Box>
    );
  }

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageError(false);
    setNaturalDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest("button, a, input, select, textarea, [role='button']")) return;
    if (isPinMode) {
      const targetEl = imgRef.current || e.currentTarget;
      const rect = targetEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const clampedX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const clampedY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
      const rx = Math.max(0, Math.min(1, clampedX / rect.width));
      const ry = Math.max(0, Math.min(1, clampedY / rect.height));

      let u = rx;
      let v = ry;
      if (rotation === 90) {
        u = ry;
        v = 1 - rx;
      } else if (rotation === 180) {
        u = 1 - rx;
        v = 1 - ry;
      } else if (rotation === 270) {
        u = 1 - ry;
        v = rx;
      }

      const xFraction = Number(Math.max(0, Math.min(1, u)).toFixed(4));
      const yFraction = Number(Math.max(0, Math.min(1, v)).toFixed(4));

      const newPin: SpatialPin2D = {
        coord: [xFraction, yFraction],
        label: `Annotation #${pins.length + 1} (${Math.round(xFraction * 100)}%, ${Math.round(yFraction * 100)}%)`,
        fieldName: title,
        metadata: naturalDimensions || undefined,
      };

      setPins((prev) => {
        const next = [...prev, newPin];
        setActivePinIndex(next.length - 1);
        return next;
      });
      onPinCreated?.(newPin);
      setIsPinMode(false);
      return;
    }

    setActivePinIndex(null);
    e.preventDefault();
    if (cleanupDragListenersRef.current) {
      cleanupDragListenersRef.current();
      cleanupDragListenersRef.current = null;
    }
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };

    const handleWindowMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      if (typeof ev.buttons === "number" && (ev.buttons & 1) === 0) {
        endDrag();
        return;
      }
      const dx = ev.clientX - dragStartRef.current.x;
      const dy = ev.clientY - dragStartRef.current.y;
      setPan({
        x: panStartRef.current.x + dx,
        y: panStartRef.current.y + dy,
      });
    };

    const handleWindowMouseUp = () => {
      endDrag();
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    window.addEventListener("pointerup", handleWindowMouseUp);
    window.addEventListener("pointercancel", handleWindowMouseUp);
    window.addEventListener("blur", handleWindowMouseUp);
    window.addEventListener("dragend", handleWindowMouseUp);

    cleanupDragListenersRef.current = () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
      window.removeEventListener("pointerup", handleWindowMouseUp);
      window.removeEventListener("pointercancel", handleWindowMouseUp);
      window.removeEventListener("blur", handleWindowMouseUp);
      window.removeEventListener("dragend", handleWindowMouseUp);
    };
  };

  const handleMouseUp = () => {
    endDrag();
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  };

  const handleRotate90 = () => {
    setRotation((prev) => ((prev + 90) % 360) as 0 | 90 | 180 | 270);
  };

  const handleDeletePin = (indexToRemove: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPins((prev) => prev.filter((_, idx) => idx !== indexToRemove));
    setActivePinIndex((prev) =>
      prev === indexToRemove ? null : prev !== null && prev > indexToRemove ? prev - 1 : prev,
    );
  };

  const handleDoubleClick = () => {
    if (zoom !== 1 || pan.x !== 0 || pan.y !== 0) {
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
          {rotation !== 0 && <InfoBadge>{rotation}°</InfoBadge>}
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
          <Button
            size="small"
            onClick={handleResetZoom}
            title="Fit / 1:1 Reset Zoom, Pan & Rotation"
            style={{ padding: "3px 8px", fontFamily: "var(--font-mono, monospace)", fontSize: "11px" }}
          >
            1:1 / Fit
          </Button>
          <Button
            size="small"
            onClick={handleRotate90}
            title="Rotate 90° clockwise"
            style={{ padding: "3px 8px", fontFamily: "var(--font-mono, monospace)", fontSize: "11px" }}
          >
            ↻ 90°
          </Button>
          {(zoom !== 1 || pan.x !== 0 || pan.y !== 0 || rotation !== 0) && (
            <IconButton
              size="small"
              icon={SyncIcon}
              aria-label="Reset View"
              title="Reset Zoom, Pan & Rotation"
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
        ref={viewportRef}
        $isDragging={isDragging}
        $isPinMode={isPinMode}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onDragStart={(e) => e.preventDefault()}
        onDoubleClick={handleDoubleClick}
      >
        {imageError ? (
          <Box
            p={4}
            display="flex"
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            gap={2}
            textAlign="center"
          >
            <Text color="var(--color-danger-fg, #f85149)" fontWeight="bold" fontSize="13px">
              Unable to load image resource
            </Text>
            <Text color="var(--color-fg-muted, #8b949e)" fontSize="12px">
              {title}
            </Text>
            <Button size="small" onClick={() => setImageError(false)}>
              Retry
            </Button>
          </Box>
        ) : (
          <ImageTransformLayer $zoom={zoom} $panX={pan.x} $panY={pan.y} $rotation={rotation}>
            <ImageStageWrapper>
              <StyledImage
                ref={imgRef}
                src={url}
                alt={title}
                decoding="async"
                $zoom={zoom}
                $isInverted={isInverted}
                onLoad={handleImageLoad}
                onError={() => setImageError(true)}
              />

              {/* 2D Spatial Pin Markers anchored to ImageStageWrapper */}
              {pins.map((pin, idx) => {
                const isActive = activePinIndex === idx;
                return (
                  <div
                    key={idx}
                    role="button"
                    tabIndex={0}
                    aria-label={pin.label || `Pin #${idx + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActivePinIndex((prev) => (prev === idx ? null : idx));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        setActivePinIndex((prev) => (prev === idx ? null : idx));
                      } else if (e.key === "Delete" || e.key === "Backspace") {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDeletePin(idx, e as unknown as React.MouseEvent);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left: `${pin.coord[0] * 100}%`,
                      top: `${pin.coord[1] * 100}%`,
                      transform: `translate(-50%, -100%) rotate(${-rotation}deg) scale(${1 / Math.max(0.5, zoom)})`,
                      transformOrigin: "bottom center",
                      pointerEvents: "auto",
                      cursor: "pointer",
                      zIndex: isActive ? 20 : 10,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: "20px", filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.85))" }}>📍</span>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        background: "rgba(14, 20, 36, 0.95)",
                        color: "#38bdf8",
                        fontSize: "10.5px",
                        fontFamily: "var(--font-mono, monospace)",
                        fontWeight: 600,
                        padding: "1px 6px",
                        borderRadius: "4px",
                        border: isActive ? "1px solid #38bdf8" : "1px solid rgba(56, 189, 248, 0.4)",
                        whiteSpace: "nowrap",
                        marginTop: "-4px",
                      }}
                    >
                      <span>{isActive ? pin.label || `#${idx + 1}` : `#${idx + 1}`}</span>
                      <button
                        type="button"
                        aria-label={`Delete Pin #${idx + 1}`}
                        title="Delete pin"
                        onClick={(e) => handleDeletePin(idx, e)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#f87171",
                          cursor: "pointer",
                          padding: "0 2px",
                          fontSize: "11px",
                          lineHeight: 1,
                          fontWeight: 700,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </ImageStageWrapper>
          </ImageTransformLayer>
        )}
        <ZoomHintBadge show={showHint && !isFullScreen} label="💡 Hold ⌘/Ctrl to zoom image" />
      </CanvasViewport>
    </Wrapper>
  );
};

export default PictureViewer;
