// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Re-export the unified, high-performance AnimationController from @modelscript/cad.
 */
import {
  AnimationController as BaseAnimationController,
  type AnimationMode,
  type AnimationState,
  type AnimationBinding as BaseAnimationBinding,
  type CadDynamicBinding,
  type ComponentTransform,
  type StateListener,
} from "@modelscript/cad";

export {
  BaseAnimationController as AnimationController,
  type AnimationMode,
  type AnimationState,
  type CadDynamicBinding,
  type ComponentTransform,
  type StateListener,
};

/** Dynamic deformation configuration for compliant soft-tissue and organ structures. */
export interface DynamicDeformationConfig {
  mode?: "volume_radial" | "anisotropic" | "modal";
  referenceVolume?: number;
  volumeVariable?: string;
  anchorOrigin?: [number, number, number];
}

/** Dynamic spatial clearance segment between two interacting CAD bodies. */
export interface DynamicClearanceSegment {
  partA: string;
  partB: string;
  pointA: [number, number, number];
  pointB: [number, number, number];
  distance: number;
  status: "safe" | "warning" | "danger";
}

/** All animation bindings for a single CAD component. */
export interface AnimationBinding extends Omit<BaseAnimationBinding, "deformationConfig"> {
  deformation?: DynamicDeformationConfig;
}

/** Alias for ComponentTransform matching clinical studio specifications. */
export type TransformResult = ComponentTransform;
