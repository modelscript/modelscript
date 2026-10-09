// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import styled from "styled-components";

export type CameraPreset = "iso" | "top" | "front" | "right" | "reset";
export type RenderMode = "shaded" | "wireframe" | "xray";

interface ViewportCameraControlsProps {
  onPresetSelect: (preset: CameraPreset) => void;
  renderMode?: RenderMode;
  onRenderModeChange?: (mode: RenderMode) => void;
  isPinMode?: boolean;
  onTogglePinMode?: () => void;
  isWireframe?: boolean;
  onToggleWireframe?: (wireframe: boolean) => void;
}

const ControlsContainer = styled.div`
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 4px 8px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  user-select: none;
`;

const PresetButton = styled.button<{ $active?: boolean }>`
  background: ${(props) => (props.$active ? "rgba(6, 182, 212, 0.25)" : "transparent")};
  color: ${(props) => (props.$active ? "#06b6d4" : "#e2e8f0")};
  border: ${(props) => (props.$active ? "1px solid rgba(6, 182, 212, 0.4)" : "1px solid transparent")};
  border-radius: 12px;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }
`;

const Divider = styled.div`
  width: 1px;
  height: 14px;
  background: rgba(255, 255, 255, 0.15);
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
}) => {
  return (
    <ControlsContainer onClick={(e) => e.stopPropagation()}>
      <PresetButton onClick={() => onPresetSelect("iso")} title="Isometric perspective view">
        ISO
      </PresetButton>
      <PresetButton onClick={() => onPresetSelect("top")} title="Top orthographic-aligned view">
        TOP
      </PresetButton>
      <PresetButton onClick={() => onPresetSelect("front")} title="Front view">
        FRONT
      </PresetButton>
      <PresetButton onClick={() => onPresetSelect("right")} title="Right side view">
        RIGHT
      </PresetButton>
      <PresetButton onClick={() => onPresetSelect("reset")} title="Reset camera to default frame">
        FIT
      </PresetButton>

      {onRenderModeChange && renderMode && (
        <>
          <Divider />
          <PresetButton
            $active={renderMode === "shaded"}
            onClick={() => onRenderModeChange("shaded")}
            title="Solid shaded surface rendering"
          >
            SHADE
          </PresetButton>
          <PresetButton
            $active={renderMode === "wireframe"}
            onClick={() => onRenderModeChange("wireframe")}
            title="Wireframe polygon mesh"
          >
            WIRE
          </PresetButton>
          <PresetButton
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
          <Divider />
          <PresetButton
            $active={isWireframe}
            onClick={() => onToggleWireframe(!isWireframe)}
            title="Toggle finite element mesh edges"
          >
            MESH
          </PresetButton>
        </>
      )}

      {onTogglePinMode && (
        <>
          <Divider />
          <PresetButton
            $active={isPinMode}
            onClick={onTogglePinMode}
            style={{
              color: isPinMode ? "#a855f7" : "#e2e8f0",
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
