// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import styled from "styled-components";
import { useTheme } from "../../theme";

export type CameraPreset = "iso" | "top" | "front" | "right" | "reset";
export type RenderMode = "shaded" | "wireframe" | "xray";
export type ClipAxis = "none" | "x" | "y" | "z";

interface ViewportCameraControlsProps {
  onPresetSelect: (preset: CameraPreset) => void;
  renderMode?: RenderMode | undefined;
  onRenderModeChange?: ((mode: RenderMode) => void) | undefined;
  isPinMode?: boolean | undefined;
  onTogglePinMode?: (() => void) | undefined;
  isWireframe?: boolean | undefined;
  onToggleWireframe?: ((wireframe: boolean) => void) | undefined;
  clipAxis?: ClipAxis | undefined;
  onClipAxisChange?: ((axis: ClipAxis) => void) | undefined;
  clipOffset?: number | undefined;
  onClipOffsetChange?: ((offset: number) => void) | undefined;
  topOffset?: string | number | undefined;
}

const ControlsContainer = styled.div<{
  $topOffset?: string | number | undefined;
  $isDark?: boolean | undefined;
}>`
  position: absolute;
  top: ${(props) =>
    props.$topOffset !== undefined
      ? typeof props.$topOffset === "number"
        ? `${props.$topOffset}px`
        : props.$topOffset
      : "12px"};
  left: 12px;
  max-width: calc(100% - 24px);
  z-index: 10;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  row-gap: 4px;
  column-gap: 6px;
  background: ${(props) => (props.$isDark === false ? "rgba(248, 250, 252, 0.88)" : "rgba(15, 23, 42, 0.78)")};
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 4px 8px;
  border-radius: 20px;
  border: 1px solid ${(props) => (props.$isDark === false ? "rgba(15, 23, 42, 0.14)" : "rgba(255, 255, 255, 0.12)")};
  box-shadow: ${(props) =>
    props.$isDark === false ? "0 4px 14px rgba(15, 23, 42, 0.12)" : "0 4px 16px rgba(0, 0, 0, 0.35)"};
  user-select: none;
`;

const PresetButton = styled.button<{
  $active?: boolean | undefined;
  $isDark?: boolean | undefined;
}>`
  background: ${(props) => (props.$active ? "rgba(6, 182, 212, 0.22)" : "transparent")};
  color: ${(props) =>
    props.$active
      ? props.$isDark === false
        ? "#0284c7"
        : "#06b6d4"
      : props.$isDark === false
        ? "#1e293b"
        : "#e2e8f0"};
  border: ${(props) => (props.$active ? "1px solid rgba(6, 182, 212, 0.45)" : "1px solid transparent")};
  border-radius: 12px;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;

  &:hover {
    background: ${(props) => (props.$isDark === false ? "rgba(15, 23, 42, 0.08)" : "rgba(255, 255, 255, 0.12)")};
    color: ${(props) => (props.$isDark === false ? "#0f172a" : "#ffffff")};
  }
`;

const Divider = styled.div<{ $isDark?: boolean | undefined }>`
  width: 1px;
  height: 14px;
  background: ${(props) => (props.$isDark === false ? "rgba(15, 23, 42, 0.15)" : "rgba(255, 255, 255, 0.15)")};
  margin: 0 2px;
`;

export const ViewportCameraControls: React.FC<ViewportCameraControlsProps> = ({
  onPresetSelect,
  renderMode,
  onRenderModeChange,
  isPinMode,
  onTogglePinMode,
  isWireframe,
  onToggleWireframe,
  clipAxis,
  onClipAxisChange,
  clipOffset = 0,
  onClipOffsetChange,
  topOffset,
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <ControlsContainer $topOffset={topOffset} $isDark={isDark} onClick={(e) => e.stopPropagation()}>
      <PresetButton $isDark={isDark} onClick={() => onPresetSelect("iso")} title="Isometric perspective view">
        ISO
      </PresetButton>
      <PresetButton $isDark={isDark} onClick={() => onPresetSelect("top")} title="Top orthographic-aligned view">
        TOP
      </PresetButton>
      <PresetButton $isDark={isDark} onClick={() => onPresetSelect("front")} title="Front view">
        FRONT
      </PresetButton>
      <PresetButton $isDark={isDark} onClick={() => onPresetSelect("right")} title="Right side view">
        RIGHT
      </PresetButton>
      <PresetButton $isDark={isDark} onClick={() => onPresetSelect("reset")} title="Reset camera to default frame">
        FIT
      </PresetButton>

      {onRenderModeChange && renderMode && (
        <>
          <Divider $isDark={isDark} />
          <PresetButton
            $isDark={isDark}
            $active={renderMode === "shaded"}
            onClick={() => onRenderModeChange("shaded")}
            title="Solid shaded surface rendering"
          >
            SHADE
          </PresetButton>
          <PresetButton
            $isDark={isDark}
            $active={renderMode === "wireframe"}
            onClick={() => onRenderModeChange("wireframe")}
            title="Wireframe polygon mesh"
          >
            WIRE
          </PresetButton>
          <PresetButton
            $isDark={isDark}
            $active={renderMode === "xray"}
            onClick={() => onRenderModeChange("xray")}
            title="Translucent X-Ray surface rendering"
          >
            X-RAY
          </PresetButton>
        </>
      )}

      {onToggleWireframe && isWireframe !== undefined && (
        <>
          <Divider $isDark={isDark} />
          <PresetButton
            $isDark={isDark}
            $active={isWireframe}
            onClick={() => onToggleWireframe(!isWireframe)}
            title="Toggle finite element mesh edges"
          >
            MESH
          </PresetButton>
        </>
      )}

      {onClipAxisChange && clipAxis !== undefined && (
        <>
          <Divider $isDark={isDark} />
          {(["x", "y", "z"] as const).map((axis) => {
            const active = clipAxis === axis;
            return (
              <PresetButton
                key={axis}
                $isDark={isDark}
                $active={active}
                onClick={() => onClipAxisChange(active ? "none" : axis)}
                title={`Toggle ${axis.toUpperCase()}-axis section cutting plane`}
              >
                CUT {axis.toUpperCase()}
              </PresetButton>
            );
          })}
          {clipAxis !== "none" && onClipOffsetChange && (
            <input
              type="range"
              min="-1"
              max="1"
              step="0.02"
              value={clipOffset}
              onChange={(e) => onClipOffsetChange(parseFloat(e.target.value))}
              aria-label="Section cutting plane offset"
              title={`Section plane offset: ${clipOffset.toFixed(2)}`}
              style={{ width: "68px", accentColor: "#06b6d4", cursor: "pointer" }}
            />
          )}
        </>
      )}

      {onTogglePinMode && (
        <>
          <Divider $isDark={isDark} />
          <PresetButton
            $isDark={isDark}
            $active={isPinMode}
            onClick={onTogglePinMode}
            style={{
              color: isPinMode ? "#a855f7" : isDark ? "#e2e8f0" : "#1e293b",
              background: isPinMode ? "rgba(168, 85, 247, 0.25)" : "transparent",
              borderColor: isPinMode ? "rgba(168, 85, 247, 0.4)" : "transparent",
            }}
            title="Click on model surface to pin a comment in replies"
          >
            📍 PIN
          </PresetButton>
        </>
      )}
    </ControlsContainer>
  );
};

export default ViewportCameraControls;
