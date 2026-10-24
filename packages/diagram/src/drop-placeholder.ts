// SPDX-License-Identifier: AGPL-3.0-or-later

export interface DropPlaceholderOptions {
  width?: number | undefined;
  height?: number | undefined;
  isDark?: boolean | undefined;
}

/**
 * Returns `true` if a cell ID belongs to a non-interactive background, axis, stem,
 * solder dot, or placement ghost node rather than a user-selectable diagram component.
 */
export function isEphemeralDiagramNode(id: string): boolean {
  return (
    id === "__diagram_background__" ||
    id === "__diagram_axes__" ||
    id.startsWith("solder_dot_") ||
    id.startsWith("__seq_stem_") ||
    id.startsWith("__alignment_guide_") ||
    id === "placement-ghost" ||
    id === "__drop_placeholder__"
  );
}

/** Expected duration of the entry bounce animation in milliseconds. */
export const DROP_BOUNCE_DURATION_MS = 240;

export interface ActiveDropPlaceholder {
  x: number;
  y: number;
  className: string;
  iconSvg?: string | null | undefined;
  timestamp: number;
}

let activeDropPlaceholder: ActiveDropPlaceholder | null = null;
let lastDropPlaceholderTime = 0;

export function getLastDropPlaceholderTime(): number {
  return lastDropPlaceholderTime;
}

export function getActiveDropPlaceholder(): ActiveDropPlaceholder | null {
  return activeDropPlaceholder;
}

export function clearActiveDropPlaceholder(): void {
  activeDropPlaceholder = null;
}

/**
 * Computes typical node dimensions from existing diagram components in the graph,
 * or returns language-appropriate defaults (e.g. 20x20 for Modelica/physical circuits).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTypicalNodeSize(g: any): { width: number; height: number } {
  if (g && typeof g.getNodes === "function") {
    const nodes = g.getNodes().filter((n: any) => !isEphemeralDiagramNode(n.id));
    const sizes = nodes
      .map((n: any) => {
        const s = n.getSize?.();
        if (s && s.width > 0 && s.height > 0) return s;
        const b = n.getBBox?.();
        if (b && b.width > 0 && b.height > 0) return { width: b.width, height: b.height };
        return { width: n.width, height: n.height };
      })
      .filter((s: any) => s && s.width > 0 && s.height > 0 && s.width <= 300 && s.height <= 300);

    if (sizes.length > 0) {
      // Sort by area to pick median representative node
      sizes.sort((a: any, b: any) => a.width * a.height - b.width * b.height);
      const median = sizes[Math.floor(sizes.length / 2)];
      return { width: Math.round(median.width), height: Math.round(median.height) };
    }
  }
  // Default to 20x20 for standard Modelica circuits (standard extent {{-10, -10}, {10, 10}})
  return { width: 20, height: 20 };
}

export function ensureDiagramStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("modelscript-diagram-animations")) return;

  const style = document.createElement("style");
  style.id = "modelscript-diagram-animations";
  style.textContent = `
    @keyframes drop-placeholder-bounce {
      0% {
        opacity: 0;
        transform: scale(0.3);
      }
      40% {
        opacity: 1;
        transform: scale(1.18);
      }
      65% {
        transform: scale(0.92);
      }
      85% {
        transform: scale(1.04);
      }
      100% {
        opacity: 1;
        transform: scale(1);
      }
    }

    @keyframes drop-placeholder-appear {
      0% {
        opacity: 0;
        transform: scale(0.3);
      }
      40% {
        opacity: 1;
        transform: scale(1.18);
      }
      65% {
        transform: scale(0.92);
      }
      85% {
        transform: scale(1.04);
      }
      100% {
        opacity: 1;
        transform: scale(1);
      }
    }

    @keyframes drop-placeholder-pulse {
      0%, 100% {
        opacity: 0.9;
        transform: scale(1);
      }
      50% {
        opacity: 1;
        transform: scale(1.05);
      }
    }

    [data-cell-id="__drop_placeholder__"],
    [data-cell-id="__drop_placeholder__"] image,
    [data-cell-id="__drop_placeholder__"] rect,
    [data-cell-id="placement-ghost"],
    [data-cell-id="placement-ghost"] image,
    [data-cell-id="placement-ghost"] rect {
      transform-box: fill-box !important;
      transform-origin: center center !important;
    }

    [data-cell-id="__diagram_background__"],
    [data-cell-id="__diagram_background__"] *,
    [data-cell-id="__diagram_axes__"],
    [data-cell-id="__diagram_axes__"] *,
    [data-cell-id="placement-ghost"],
    [data-cell-id="placement-ghost"] *,
    [data-cell-id="__drop_placeholder__"],
    [data-cell-id="__drop_placeholder__"] * {
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
}

export function dropComponentGhost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  g: any,
  x: number,
  y: number,
  className: string,
  iconSvg?: string | null,
  isDark?: boolean,
  width?: number,
  height?: number,
) {
  ensureDiagramStyles();
  lastDropPlaceholderTime = Date.now();
  activeDropPlaceholder = {
    x,
    y,
    className,
    iconSvg: iconSvg ?? undefined,
    timestamp: Date.now(),
  };
  const strokeColor = isDark ? "#cccccc" : "#333333";
  const fillColor = isDark ? "rgba(204, 204, 204, 0.15)" : "rgba(51, 51, 51, 0.08)";

  // Remove any previous placeholder or ghost
  const existing = g.getCellById?.("__drop_placeholder__");
  if (existing) g.removeCell?.(existing);
  const ghost = g.getCellById?.("placement-ghost");
  if (ghost) g.removeCell?.(ghost);

  const nodeSize = width && height ? { width, height } : getTypicalNodeSize(g);
  const w = nodeSize.width;
  const h = nodeSize.height;
  const halfW = w / 2;
  const halfH = h / 2;

  if (iconSvg) {
    return g.addNode({
      id: "__drop_placeholder__",
      shape: "image",
      x: x - halfW,
      y: y - halfH,
      width: w,
      height: h,
      zIndex: 9999,
      imageUrl: `data:image/svg+xml;utf8,${encodeURIComponent(iconSvg)}`,
      attrs: {
        image: {
          preserveAspectRatio: "xMidYMid meet",
          style:
            "pointer-events: none; transform-box: fill-box; transform-origin: center center; animation: drop-placeholder-bounce 0.24s cubic-bezier(0.2, 0.8, 0.2, 1) forwards, drop-placeholder-pulse 1.4s ease-in-out infinite 0.24s;",
        },
      },
    });
  } else {
    return g.addNode({
      id: "__drop_placeholder__",
      shape: "rect",
      x: x - halfW,
      y: y - halfH,
      width: w,
      height: h,
      zIndex: 9999,
      attrs: {
        body: {
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: 2,
          rx: 6,
          ry: 6,
          strokeDasharray: "4 2",
          pointerEvents: "none",
          style:
            "transform-box: fill-box; transform-origin: center center; animation: drop-placeholder-bounce 0.24s cubic-bezier(0.2, 0.8, 0.2, 1) forwards, drop-placeholder-pulse 1.4s ease-in-out infinite 0.24s;",
        },
        text: {
          text: className.split(".").pop(),
          fill: strokeColor,
          pointerEvents: "none",
          fontSize: 10,
          fontWeight: "600",
        },
      },
    });
  }
}
