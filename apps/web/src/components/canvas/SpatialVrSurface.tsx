// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasDocument, CanvasPeerPresence, SurfacePresentationMode } from "@modelscript/canvas";
import { EngineeringRotunda } from "@modelscript/editor/workbench/vr-rotunda/EngineeringRotunda.js";
import type {
  RotundaAnimationControllerLike,
  RotundaEnvironmentId,
  RotundaModelEntry,
  RotundaScenarioPreset,
} from "@modelscript/editor/workbench/vr-rotunda/types.js";
import React from "react";

export type { RotundaAnimationControllerLike, RotundaEnvironmentId, RotundaModelEntry, RotundaScenarioPreset };

export interface SpatialVrSurfaceProps {
  document: CanvasDocument;
  mode: SurfacePresentationMode;
  initialEnvironment?: RotundaEnvironmentId | undefined;
  simulationTime?: number | undefined;
  onSimulationTimeChange?: ((time: number) => void) | undefined;
  models?: readonly RotundaModelEntry[] | undefined;
  scenarios?: readonly RotundaScenarioPreset[] | undefined;
  activeScenarioId?: string | undefined;
  onSelectScenario?: ((scenarioId: string) => void) | undefined;
  peers?: readonly CanvasPeerPresence[] | undefined;
  animationController?: RotundaAnimationControllerLike | null | undefined;
  title?: string | undefined;
  onExitTo2D?: (() => void) | undefined;
  onTileSelect?: ((tileId: string) => void) | undefined;
  onMoveTile?: ((tileId: string, x: number, y: number) => void) | undefined;
  onCreateSpatialWire?: ((sourceTileId: string, targetTileId: string, sourceAnchor?: string) => void) | undefined;
}

/**
 * Unified 3D Spatial & WebXR VR Editing Surface delegating directly to the
 * Engineering Rotunda workstation (`@modelscript/editor/workbench/vr-rotunda/EngineeringRotunda`).
 * Preserves full backward compatibility for `.mscanvas` spatial boards, SSR markup,
 * JSDOM fallback Canvas2D painting, ray drag write-back, and 3D CADPort-to-2D wiring.
 */
export function SpatialVrSurface({
  document: doc,
  mode,
  initialEnvironment,
  simulationTime,
  onSimulationTimeChange,
  models,
  scenarios,
  activeScenarioId,
  onSelectScenario,
  peers,
  animationController,
  title,
  onExitTo2D,
  onTileSelect,
  onMoveTile,
  onCreateSpatialWire,
}: SpatialVrSurfaceProps): React.ReactElement {
  return (
    <EngineeringRotunda
      document={doc}
      mode={mode}
      initialEnvironment={initialEnvironment}
      simulationTime={simulationTime}
      onSimulationTimeChange={onSimulationTimeChange}
      models={models}
      scenarios={scenarios}
      activeScenarioId={activeScenarioId}
      onSelectScenario={onSelectScenario}
      peers={peers}
      animationController={animationController}
      title={title}
      onExitTo2D={onExitTo2D}
      onTileSelect={onTileSelect}
      onMoveTile={onMoveTile}
      onCreateSpatialWire={onCreateSpatialWire}
    />
  );
}
