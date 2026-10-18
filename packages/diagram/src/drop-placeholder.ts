// SPDX-License-Identifier: AGPL-3.0-or-later

export interface DropPlaceholderOptions {
  width?: number | undefined;
  height?: number | undefined;
  isDark?: boolean | undefined;
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
        transform: scale(0.2);
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
        transform: scale(0.2);
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
        opacity: 0.75;
        transform: scale(1);
      }
      50% {
        opacity: 1;
        transform: scale(1.05);
      }
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
  width = 40,
  height = 40,
) {
  ensureDiagramStyles();
  const strokeColor = isDark ? "#cccccc" : "#333333";
  const fillColor = isDark ? "rgba(204, 204, 204, 0.15)" : "rgba(51, 51, 51, 0.08)";

  // Remove any previous placeholder or ghost
  const existing = g.getCellById?.("__drop_placeholder__");
  if (existing) g.removeCell?.(existing);
  const ghost = g.getCellById?.("placement-ghost");
  if (ghost) g.removeCell?.(ghost);

  const halfW = width / 2;
  const halfH = height / 2;

  if (iconSvg) {
    return g.addNode({
      id: "__drop_placeholder__",
      shape: "image",
      x: x - halfW,
      y: y - halfH,
      width,
      height,
      imageUrl: `data:image/svg+xml;utf8,${encodeURIComponent(iconSvg)}`,
      attrs: {
        image: {
          preserveAspectRatio: "xMidYMid meet",
          style:
            "pointer-events: none; transform-origin: center center; animation: drop-placeholder-bounce 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards, drop-placeholder-pulse 1.4s ease-in-out infinite 0.45s;",
        },
      },
    });
  } else {
    return g.addNode({
      id: "__drop_placeholder__",
      shape: "rect",
      x: x - halfW,
      y: y - halfH,
      width,
      height,
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
            "transform-origin: center center; animation: drop-placeholder-bounce 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards, drop-placeholder-pulse 1.4s ease-in-out infinite 0.45s;",
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
