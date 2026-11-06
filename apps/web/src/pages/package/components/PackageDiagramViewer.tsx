// SPDX-License-Identifier: AGPL-3.0-or-later

import { DashIcon, PlusIcon, ScreenFullIcon, ScreenNormalIcon, SyncIcon } from "@primer/octicons-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import InvertedSvg from "../../../components/InvertedSvg";
import { useWheelZoom, ZoomHintBadge } from "../../../components/artifacts/useArtifactZoom";
import { DiagramToolbar, DiagramToolbarButton, DiagramViewport, DiagramWrap } from "../../class-detail/styles";

export interface PackageDiagramViewerProps {
  /** The SVG image or diagram source URL */
  src: string;
  /** Accessible alt text describing the diagram */
  alt: string;
  /** Optional custom CSS class name */
  className?: string | undefined;
  /** Optional inline styles applied to the outer container when not in fullscreen mode */
  style?: React.CSSProperties | undefined;
  /** Minimum container height */
  minHeight?: number | string | undefined;
  /** Maximum container height */
  maxHeight?: number | string | undefined;
  /** CSS aspect ratio (default: '2.4 / 1' when not fullscreen) */
  aspectRatio?: string | undefined;
  /** Initial zoom multiplier (default: 1.0) */
  initialZoom?: number | undefined;
  /** Minimum allowed zoom multiplier (default: 0.4) */
  minZoom?: number | undefined;
  /** Maximum allowed zoom multiplier (default: 4.0) */
  maxZoom?: number | undefined;
  /** External loaded state if controlled by parent component */
  loaded?: boolean | undefined;
  /** Callback fired when loaded state changes */
  setLoaded?: ((loaded: boolean) => void) | undefined;
  /** External error flag */
  isError?: boolean | undefined;
  /** Callback when diagram image encounters a load error */
  onError?: ((err?: unknown) => void) | undefined;
  /** Callback when diagram image finishes loading */
  onLoad?: (() => void) | undefined;
  /** Whether to show the floating zoom & pan controls toolbar (default: true) */
  showToolbar?: boolean | undefined;
}

export const PackageDiagramViewer: React.FC<PackageDiagramViewerProps> = ({
  src,
  alt,
  className,
  style,
  minHeight,
  maxHeight,
  aspectRatio,
  initialZoom = 1,
  minZoom = 0.4,
  maxZoom = 4.0,
  loaded,
  setLoaded,
  isError = false,
  onError,
  onLoad,
  showToolbar = true,
}) => {
  const [internalLoaded, setInternalLoaded] = useState(false);
  const isLoaded = loaded !== undefined ? loaded : internalLoaded;

  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [detectedRatio, setDetectedRatio] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
    moved: false,
  });
  const cleanupDragListenersRef = useRef<(() => void) | null>(null);

  // Reset zoom & pan when source URL changes
  useEffect(() => {
    setZoom(initialZoom);
    setPan({ x: 0, y: 0 });
    setInternalLoaded(false);
    setDetectedRatio(null);
  }, [src, initialZoom]);

  // Handle Fullscreen escape key and lock body scrolling
  useEffect(() => {
    if (!isFullScreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullScreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullScreen]);

  // Hook for smooth focal-point zoom with wheel/pinch & feed scroll protection hint
  const { showHint } = useWheelZoom({
    containerRef: viewportRef,
    zoom,
    setZoom,
    pan,
    setPan,
    isFullScreen,
    minZoom,
    maxZoom,
  });

  const endDrag = useCallback(() => {
    dragRef.current.active = false;
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

  const updatePanFromPoint = useCallback((clientX: number, clientY: number) => {
    const dx = clientX - dragRef.current.startX;
    const dy = clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragRef.current.moved = true;
    }
    setPan({
      x: Math.round(dragRef.current.origX + dx),
      y: Math.round(dragRef.current.origY + dy),
    });
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Left mouse button only
    if ((e.target as HTMLElement | null)?.closest("button, a, input, select, textarea, [role='button']")) return;

    e.preventDefault();
    if (cleanupDragListenersRef.current) {
      cleanupDragListenersRef.current();
      cleanupDragListenersRef.current = null;
    }

    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
      moved: false,
    };
    setIsDragging(true);

    const handleWindowMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current.active) return;
      if (typeof ev.buttons === "number" && (ev.buttons & 1) === 0) {
        endDrag();
        return;
      }
      updatePanFromPoint(ev.clientX, ev.clientY);
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

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    if (typeof e.buttons === "number" && (e.buttons & 1) === 0) {
      endDrag();
      return;
    }
    updatePanFromPoint(e.clientX, e.clientY);
  };

  const handleMouseUp = () => {
    endDrag();
  };

  const handleZoomIn = () => {
    setZoom((z) => Math.min(Number((z + 0.25).toFixed(2)), maxZoom));
  };

  const handleZoomOut = () => {
    setZoom((z) => Math.max(Number((z - 0.25).toFixed(2)), minZoom));
  };

  const handleResetZoomPan = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement | null)?.closest("button, a, input, select, textarea, [role='button']")) return;
    handleResetZoomPan();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && (e.target as HTMLElement)?.closest("input, textarea, select")) return;
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      handleZoomIn();
    } else if (e.key === "-") {
      e.preventDefault();
      handleZoomOut();
    } else if (e.key === "0") {
      e.preventDefault();
      handleResetZoomPan();
    } else if (e.key === "f" || e.key === "F") {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setIsFullScreen((p) => !p);
      }
    }
  };

  return (
    <DiagramWrap
      ref={viewportRef}
      className={className}
      $isDragging={isDragging}
      $isFullScreen={isFullScreen}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onDragStart={(e) => e.preventDefault()}
      tabIndex={0}
      role="region"
      aria-label="Interactive Diagram Viewer"
      style={{
        cursor: isLoaded ? (isDragging ? "grabbing" : "grab") : "default",
        ...(isFullScreen ? undefined : style),
        ...(minHeight !== undefined && !isFullScreen ? { minHeight } : undefined),
        ...(maxHeight !== undefined && !isFullScreen ? { maxHeight } : undefined),
        ...(aspectRatio !== undefined && !isFullScreen
          ? { aspectRatio }
          : detectedRatio !== null && !isFullScreen
            ? { aspectRatio: detectedRatio }
            : undefined),
      }}
    >
      {!isLoaded && !isError && (
        <div className="skeleton" style={{ width: "100%", height: "100%", borderRadius: "8px" }} />
      )}

      {isLoaded && showToolbar && (
        <DiagramToolbar role="toolbar" aria-label="Diagram zoom and view controls">
          <DiagramToolbarButton
            type="button"
            onClick={handleZoomOut}
            title="Zoom Out (-)"
            aria-label="Zoom Out"
            style={{ width: 24, minWidth: 24 }}
          >
            <DashIcon size={13} />
          </DiagramToolbarButton>
          <DiagramToolbarButton
            type="button"
            $active={zoom !== 1 || pan.x !== 0 || pan.y !== 0}
            $minWidth="48px"
            style={{ width: 48, minWidth: 48, textAlign: "center", justifyContent: "center" }}
            onClick={handleResetZoomPan}
            title="Reset Zoom & Pan (0)"
            aria-label="Reset Zoom & Pan"
          >
            {Math.round(zoom * 100)}%
          </DiagramToolbarButton>
          <DiagramToolbarButton
            type="button"
            onClick={handleZoomIn}
            title="Zoom In (+)"
            aria-label="Zoom In"
            style={{ width: 24, minWidth: 24 }}
          >
            <PlusIcon size={13} />
          </DiagramToolbarButton>
          <DiagramToolbarButton
            type="button"
            onClick={handleResetZoomPan}
            disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
            title="Reset View"
            aria-label="Reset View"
            style={{ width: 24, minWidth: 24 }}
          >
            <SyncIcon size={12} />
          </DiagramToolbarButton>
          <DiagramToolbarButton
            type="button"
            $active={isFullScreen}
            onClick={() => setIsFullScreen((p) => !p)}
            title={isFullScreen ? "Exit Fullscreen (Esc)" : "Fullscreen (F)"}
            aria-label={isFullScreen ? "Exit Fullscreen" : "Fullscreen"}
            style={{ width: 24, minWidth: 24 }}
          >
            {isFullScreen ? <ScreenNormalIcon size={13} /> : <ScreenFullIcon size={13} />}
          </DiagramToolbarButton>
        </DiagramToolbar>
      )}

      <ZoomHintBadge show={showHint && !isFullScreen} label="💡 Hold ⌘/Ctrl to zoom diagram" />

      <DiagramViewport $loaded={isLoaded} $zoom={zoom} $panX={pan.x} $panY={pan.y} $isDragging={isDragging}>
        <InvertedSvg
          src={src}
          alt={alt}
          width="100%"
          height="100%"
          disableStrokeOverride={true}
          onLoad={() => {
            setInternalLoaded(true);
            setLoaded?.(true);
            const svgEl = viewportRef.current?.querySelector("svg");
            if (svgEl) {
              const vb = svgEl.getAttribute("viewBox");
              if (vb) {
                const parts = vb
                  .trim()
                  .split(/[\s,]+/)
                  .map(Number);
                if (parts.length === 4 && parts[2] && parts[3] && parts[2] > 0 && parts[3] > 0) {
                  const r = Math.round((parts[2] / parts[3]) * 100) / 100;
                  setDetectedRatio(`${r} / 1`);
                }
              }
            }
            onLoad?.();
          }}
          onError={(err) => {
            onError?.(err);
          }}
        />
      </DiagramViewport>
    </DiagramWrap>
  );
};

export default PackageDiagramViewer;
