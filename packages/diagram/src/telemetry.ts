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

/**
 * Fixed-capacity circular buffer for real-time telemetry sparkline graphs.
 */
export class SparklineRingBuffer {
  private readonly buffer: number[];
  private head = 0;
  private isFull = false;

  constructor(public readonly capacity = 30) {
    this.buffer = new Array(capacity);
  }

  push(val: number): void {
    this.buffer[this.head] = val;
    this.head = (this.head + 1) % this.capacity;
    if (this.head === 0) this.isFull = true;
  }

  toArray(): number[] {
    if (!this.isFull) return this.buffer.slice(0, this.head);
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
  }

  toPoints(width = 60, height = 20): string {
    const values = this.toArray();
    if (values.length === 0) return "";
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max === min ? 1 : max - min;
    const step = values.length > 1 ? width / (values.length - 1) : width;
    return values
      .map((v, i) => {
        const x = (i * step).toFixed(1);
        const y = (height - ((v - min) / range) * height).toFixed(1);
        return `${x},${y}`;
      })
      .join(" ");
  }
}

const sparklineBuffers = new Map<string, SparklineRingBuffer>();

export interface ReactiveAnimationBinding {
  cellId?: string | undefined;
  property: string;
  variableName: string;
  transform?: string | undefined;
  range?: [number, number] | undefined;
}

export interface AnimatableCell {
  id?: string | undefined;
  getData?: (() => { animations?: ReactiveAnimationBinding[] | undefined } | undefined) | undefined;
  rotate?: ((angle: number, options?: { absolute?: boolean | undefined }) => void) | undefined;
  attr?: ((path: string, val: unknown) => void) | undefined;
  setVisible?: ((visible: boolean) => void) | undefined;
  translate?: ((dx: number, dy: number) => void) | undefined;
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
      } else if (anim.property === "colormap" || anim.property === "voltage") {
        const min = anim.range?.[0] ?? 0;
        const max = anim.range?.[1] ?? 1;
        const norm = max > min ? (val - min) / (max - min) : val;
        node.attr?.("body/fill", turboColormap(norm));
      } else if (anim.property === "breaker" || anim.property === "switch" || anim.property === "state") {
        const isOpen = Math.abs(val) < 0.5;
        node.attr?.("breaker/text", isOpen ? "OPEN" : "CLOSED");
        node.attr?.("breaker/fill", isOpen ? "#22c55e" : "#ef4444");
        node.attr?.("body/stroke", isOpen ? "#22c55e" : "#ef4444");
        node.attr?.("badge/text", isOpen ? "OPEN" : "CLOSED");
        node.attr?.("badge/fill", isOpen ? "#22c55e" : "#ef4444");
      } else if (anim.property === "dial" || anim.property === "needle") {
        // Rotating needle pointer for circular gauges
        node.attr?.("needle/transform", `rotate(${val} 50 50)`);
      } else if (anim.property === "meter" || anim.property === "level" || anim.property === "progress") {
        // Linear level / progress bar
        const min = anim.range?.[0] ?? 0;
        const max = anim.range?.[1] ?? 100;
        const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
        node.attr?.("meter/width", `${pct.toFixed(1)}%`);
        node.attr?.("meter/fill", turboColormap(pct / 100));
      } else if (anim.property === "sparkline") {
        // Mini history line chart
        const bufferKey = `${node.id ?? "n"}_${anim.variableName}`;
        let buf = sparklineBuffers.get(bufferKey);
        if (!buf) {
          buf = new SparklineRingBuffer(30);
          sparklineBuffers.set(bufferKey, buf);
        }
        buf.push(val);
        node.attr?.("sparkline/points", buf.toPoints(60, 20));
      }
    }
  }

  // 2. Animate edges (flow particles, line thickness, pressure colors, voltages)
  for (const edge of cells.edges) {
    const anims = edge.getData?.()?.animations;
    if (!anims || anims.length === 0) continue;
    for (const anim of anims) {
      const val = extractVal(anim.variableName);
      if (val === undefined) continue;

      if (anim.property === "flow" || anim.property === "current" || anim.property === "dashoffset") {
        edge.attr?.("line/strokeDasharray", "6 4");
        edge.attr?.("line/strokeDashoffset", val);
      } else if (anim.property === "strokeWidth") {
        edge.attr?.("line/strokeWidth", Math.max(1, val));
      } else if (anim.property === "stroke" || anim.property === "color") {
        edge.attr?.("line/stroke", String(val));
      } else if (anim.property === "colormap" || anim.property === "voltage") {
        const min = anim.range?.[0] ?? 0;
        const max = anim.range?.[1] ?? 1;
        const norm = max > min ? (val - min) / (max - min) : val;
        edge.attr?.("line/stroke", turboColormap(norm));
      }
    }
  }
}

export interface SimulationFrame {
  time?: number;
  stateVector: Record<string, number> | Float64Array;
  varIndexMap?: Map<string, number> | Record<string, number>;
}

export interface LiveValueBadgeOptions {
  /** Number of decimal places to display (default: 2). */
  precision?: number | undefined;
  /** Optional unit lookup keyed by variable or cell ID. */
  units?: Record<string, string> | undefined;
  /** Optional [min, max] range for heat-map stroke coloring on edges/nodes. */
  heatmapRange?: [number, number] | undefined;
}

/**
 * Applies inline live simulation value badges (and optional Turbo heat-map stroke coloring)
 * to diagram nodes and edges whose IDs match keys in `values` (e.g., `R1.v`, `bus_1`, `wire_2`).
 * Shared across Morsel and VS Code for unified live telemetry overlays.
 */
export function applyLiveValueBadges(
  cells: {
    nodes: Array<AnimatableCell & { setAttrs?: ((attrs: Record<string, unknown>) => void) | undefined }>;
    edges: Array<AnimatableCell & { setLabels?: ((labels: unknown[]) => void) | undefined }>;
  },
  values: Record<string, number>,
  options: LiveValueBadgeOptions = {},
): number {
  const precision = options.precision ?? 2;
  const units = options.units;
  const range = options.heatmapRange;
  let updated = 0;

  const formatVal = (key: string, v: number): string => {
    const unit = units?.[key] ? ` ${units[key]}` : "";
    return `${v.toFixed(precision)}${unit}`;
  };

  const colorFor = (v: number): string | null => {
    if (!range || range[1] <= range[0]) return null;
    return turboColormap((v - range[0]) / (range[1] - range[0]));
  };

  for (const node of cells.nodes) {
    const id = node.id;
    if (!id) continue;
    const val = values[id];
    if (typeof val !== "number" || !Number.isFinite(val)) continue;
    node.attr?.("badge/text", formatVal(id, val));
    const col = colorFor(val);
    if (col) node.attr?.("body/stroke", col);
    updated++;
  }

  for (const edge of cells.edges) {
    const id = edge.id;
    if (!id) continue;
    const val = values[id];
    if (typeof val !== "number" || !Number.isFinite(val)) continue;
    const text = formatVal(id, val);
    if (typeof edge.setLabels === "function") {
      edge.setLabels([{ attrs: { text: { text } }, position: 0.5 }]);
    } else {
      edge.attr?.("label/text", text);
    }
    const col = colorFor(val);
    if (col) edge.attr?.("line/stroke", col);
    updated++;
  }

  return updated;
}
