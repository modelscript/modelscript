// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Re-export the unified, high-performance AnimationController from @modelscript/cad
 * with support for "deformation" property bindings as uniform XYZ scale.
 */
import {
  AnimationController as BaseAnimationController,
  type AnimationBinding,
  type AnimationMode,
  type AnimationState,
  type CadDynamicBinding,
  type ComponentTransform,
  type StateListener,
} from "@modelscript/cad";

export class AnimationController extends BaseAnimationController {
  override setBindings(bindings: AnimationBinding[]): void {
    const normalized: AnimationBinding[] = bindings.map((entry) => ({
      ...entry,
      bindings: entry.bindings.map((b) =>
        b.property === "deformation"
          ? {
              ...b,
              property: "scale",
              index: undefined,
            }
          : b,
      ),
    }));
    super.setBindings(normalized);
  }
}

export {
  type AnimationBinding,
  type AnimationMode,
  type AnimationState,
  type CadDynamicBinding,
  type ComponentTransform,
  type StateListener,
};
