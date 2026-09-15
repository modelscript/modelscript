// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fast polynomial Turbo colormap approximation.
 * Maps a normalized float [0, 1] to an rgb(...) color string.
 */
export function turboColormap(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const r = Math.round(255 * (0.1357 + c * (4.61539 - c * (42.6603 - c * (132.131 - c * (152.55 - c * 59.2863))))));
  const g = Math.round(255 * (0.0914 + c * (2.19419 + c * (4.87492 - c * (14.2301 + c * (5.6025 - c * 0.1583))))));
  const b = Math.round(255 * (0.1067 + c * (12.5833 - c * (78.5085 - c * (228.675 - c * (290.49 - c * 128.42))))));
  return `rgb(${Math.max(0, Math.min(255, r))},${Math.max(0, Math.min(255, g))},${Math.max(0, Math.min(255, b))})`;
}

export interface ReactiveAnimationBinding {
  cellId?: string;
  property: string;
  variableName: string;
  transform?: string;
  range?: [number, number];
}

export interface AnimatableCell {
  getData?: () => { animations?: ReactiveAnimationBinding[] } | undefined;
  rotate?: (angle: number, options?: { absolute?: boolean }) => void;
  attr?: (path: string, val: any) => void;
  setVisible?: (visible: boolean) => void;
  translate?: (dx: number, dy: number) => void;
}

/**
 * Animates a set of nodes and edges from a simulation state vector.
 * Decoupled from AntV X6 graph instance to allow testing and headless telemetry processing.
 */
export function animateCells(
  cells: { nodes: AnimatableCell[]; edges: AnimatableCell[] },
  stateVector: Record<string, number> | Float64Array,
  varIndexMap?: Map<string, number> | Record<string, number>,
): void {
  const isBuffer = stateVector instanceof Float64Array;

  const extractVal = (varName: string): number | undefined => {
    if (isBuffer) {
      if (!varIndexMap) return undefined;
      const idx = varIndexMap instanceof Map ? varIndexMap.get(varName) : varIndexMap[varName];
      if (idx !== undefined && idx >= 0 && idx < stateVector.length) {
        return stateVector[idx];
      }
      return undefined;
    }
    return (stateVector as Record<string, number>)[varName];
  };

  // 1. Animate nodes
  for (const node of cells.nodes) {
    const anims = node.getData?.()?.animations;
    if (!anims || anims.length === 0) continue;
    for (const anim of anims) {
      const val = extractVal(anim.variableName);
      if (val === undefined) continue;
      if (anim.property === "rotation") {
        node.rotate?.(val, { absolute: true });
      } else if (anim.property === "fill" || anim.property === "stroke") {
        node.attr?.(`body/${anim.property}`, String(val));
      } else if (anim.property === "visibility") {
        node.setVisible?.(Boolean(val));
      } else if (anim.property === "dx" || anim.property === "translateX") {
        node.translate?.(val, 0);
      } else if (anim.property === "dy" || anim.property === "translateY") {
        node.translate?.(0, val);
      } else if (anim.property === "text" || anim.property === "label") {
        node.attr?.("label/text", typeof val === "number" ? val.toFixed(2) : String(val));
      } else if (anim.property === "colormap") {
        node.attr?.("body/fill", turboColormap(val));
      }
    }
  }

  // 2. Animate edges (flow particles, line thickness, pressure colors)
  for (const edge of cells.edges) {
    const anims = edge.getData?.()?.animations;
    if (!anims || anims.length === 0) continue;
    for (const anim of anims) {
      const val = extractVal(anim.variableName);
      if (val === undefined) continue;

      if (anim.property === "flow" || anim.property === "dashoffset") {
        edge.attr?.("line/strokeDashoffset", val);
      } else if (anim.property === "strokeWidth") {
        edge.attr?.("line/strokeWidth", Math.max(1, val));
      } else if (anim.property === "stroke" || anim.property === "color") {
        edge.attr?.("line/stroke", String(val));
      } else if (anim.property === "colormap") {
        edge.attr?.("line/stroke", turboColormap(val));
      }
    }
  }
}
