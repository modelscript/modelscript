// SPDX-License-Identifier: AGPL-3.0-or-later

export interface AlignableNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AlignmentType =
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-top"
  | "align-middle"
  | "align-bottom"
  | "distribute-horizontal"
  | "distribute-vertical"
  | "rotate-cw";

/**
 * Computes updated coordinates for a set of nodes according to the requested CAD alignment
 * or even distribution mode, snapping to grid if specified.
 */
export function computeNodeAlignment(
  nodes: AlignableNode[],
  type: AlignmentType,
  snapGrid = 1,
): { id: string; x: number; y: number }[] {
  if (nodes.length < 2) return [];

  const round = (val: number): number => {
    if (snapGrid > 1) {
      return Math.round(val / snapGrid) * snapGrid;
    }
    return Math.round(val);
  };

  const results: { id: string; x: number; y: number }[] = [];

  switch (type) {
    case "align-left": {
      const minX = Math.min(...nodes.map((n) => n.x));
      const targetX = round(minX);
      for (const n of nodes) {
        results.push({ id: n.id, x: targetX, y: n.y });
      }
      break;
    }

    case "align-right": {
      const maxRight = Math.max(...nodes.map((n) => n.x + n.width));
      for (const n of nodes) {
        results.push({ id: n.id, x: round(maxRight - n.width), y: n.y });
      }
      break;
    }

    case "align-center": {
      const minX = Math.min(...nodes.map((n) => n.x));
      const maxRight = Math.max(...nodes.map((n) => n.x + n.width));
      const centerX = (minX + maxRight) / 2;
      for (const n of nodes) {
        results.push({ id: n.id, x: round(centerX - n.width / 2), y: n.y });
      }
      break;
    }

    case "align-top": {
      const minY = Math.min(...nodes.map((n) => n.y));
      const targetY = round(minY);
      for (const n of nodes) {
        results.push({ id: n.id, x: n.x, y: targetY });
      }
      break;
    }

    case "align-bottom": {
      const maxBottom = Math.max(...nodes.map((n) => n.y + n.height));
      for (const n of nodes) {
        results.push({ id: n.id, x: n.x, y: round(maxBottom - n.height) });
      }
      break;
    }

    case "align-middle": {
      const minY = Math.min(...nodes.map((n) => n.y));
      const maxBottom = Math.max(...nodes.map((n) => n.y + n.height));
      const centerY = (minY + maxBottom) / 2;
      for (const n of nodes) {
        results.push({ id: n.id, x: n.x, y: round(centerY - n.height / 2) });
      }
      break;
    }

    case "distribute-horizontal": {
      if (nodes.length < 3) {
        // With 2 nodes, distribute horizontal is a no-op
        return [];
      }
      // Sort nodes from left to right
      const sorted = [...nodes].sort((a, b) => a.x - b.x);
      const first = sorted[0]!;
      const last = sorted[sorted.length - 1]!;

      const totalSpan = last.x + last.width - first.x;
      const totalWidths = sorted.reduce((sum, n) => sum + n.width, 0);
      const totalGap = totalSpan - totalWidths;
      const gap = totalGap / (sorted.length - 1);

      let currentX = first.x;
      for (let i = 0; i < sorted.length; i++) {
        const n = sorted[i]!;
        if (i === 0) {
          results.push({ id: n.id, x: n.x, y: n.y });
          currentX += n.width + gap;
        } else if (i === sorted.length - 1) {
          results.push({ id: n.id, x: n.x, y: n.y });
        } else {
          results.push({ id: n.id, x: round(currentX), y: n.y });
          currentX += n.width + gap;
        }
      }
      break;
    }

    case "distribute-vertical": {
      if (nodes.length < 3) {
        return [];
      }
      // Sort nodes from top to bottom
      const sorted = [...nodes].sort((a, b) => a.y - b.y);
      const first = sorted[0]!;
      const last = sorted[sorted.length - 1]!;

      const totalSpan = last.y + last.height - first.y;
      const totalHeights = sorted.reduce((sum, n) => sum + n.height, 0);
      const totalGap = totalSpan - totalHeights;
      const gap = totalGap / (sorted.length - 1);

      let currentY = first.y;
      for (let i = 0; i < sorted.length; i++) {
        const n = sorted[i]!;
        if (i === 0) {
          results.push({ id: n.id, x: n.x, y: n.y });
          currentY += n.height + gap;
        } else if (i === sorted.length - 1) {
          results.push({ id: n.id, x: n.x, y: n.y });
        } else {
          results.push({ id: n.id, x: n.x, y: round(currentY) });
          currentY += n.height + gap;
        }
      }
      break;
    }
  }

  return results;
}

/**
 * Creates or retrieves the floating CAD Multi-Node Alignment & Distribution toolbar in the DOM.
 */
export function ensureAlignmentToolbar(
  container: HTMLElement,
  onAction: (type: AlignmentType) => void,
): HTMLElement | null {
  if (typeof document === "undefined" || !container) return null;
  let bar = container.querySelector("#modelscript-alignment-toolbar") as HTMLElement | null;
  if (bar) return bar;

  bar = document.createElement("div");
  bar.id = "modelscript-alignment-toolbar";
  bar.className = "modelscript-alignment-toolbar";
  bar.style.position = "absolute";
  bar.style.display = "none";
  bar.style.zIndex = "1000";
  bar.style.transform = "translate(-50%, -100%)";
  bar.style.transition = "opacity 0.15s ease, transform 0.15s ease";
  bar.style.opacity = "0";

  const buttons: { type: AlignmentType; title: string; svg: string }[] = [
    {
      type: "align-left",
      title: "Align Left (Alt+L)",
      svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="2" height="14" rx="0.5"/><rect x="5" y="3" width="8" height="4" rx="1"/><rect x="5" y="9" width="5" height="4" rx="1"/></svg>',
    },
    {
      type: "align-center",
      title: "Align Center Horizontally",
      svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="7" y="1" width="2" height="14" rx="0.5"/><rect x="3" y="3" width="10" height="4" rx="1"/><rect x="4.5" y="9" width="7" height="4" rx="1"/></svg>',
    },
    {
      type: "align-right",
      title: "Align Right (Alt+R)",
      svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="13" y="1" width="2" height="14" rx="0.5"/><rect x="3" y="3" width="8" height="4" rx="1"/><rect x="6" y="9" width="5" height="4" rx="1"/></svg>',
    },
    {
      type: "align-top",
      title: "Align Top (Alt+T)",
      svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="14" height="2" rx="0.5"/><rect x="3" y="5" width="4" height="8" rx="1"/><rect x="9" y="5" width="4" height="5" rx="1"/></svg>',
    },
    {
      type: "align-middle",
      title: "Align Middle Vertically",
      svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="7" width="14" height="2" rx="0.5"/><rect x="3" y="3" width="4" height="10" rx="1"/><rect x="9" y="4.5" width="4" height="7" rx="1"/></svg>',
    },
    {
      type: "align-bottom",
      title: "Align Bottom (Alt+B)",
      svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="13" width="14" height="2" rx="0.5"/><rect x="3" y="3" width="4" height="8" rx="1"/><rect x="9" y="6" width="4" height="5" rx="1"/></svg>',
    },
    {
      type: "distribute-horizontal",
      title: "Distribute Horizontally (Alt+H)",
      svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="2" height="14" rx="0.5"/><rect x="13" y="1" width="2" height="14" rx="0.5"/><rect x="6" y="4" width="4" height="8" rx="1"/></svg>',
    },
    {
      type: "distribute-vertical",
      title: "Distribute Vertically (Alt+V)",
      svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="14" height="2" rx="0.5"/><rect x="1" y="13" width="14" height="2" rx="0.5"/><rect x="4" y="6" width="8" height="4" rx="1"/></svg>',
    },
    {
      type: "rotate-cw",
      title: "Rotate 90° Clockwise (R)",
      svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 7A6 6 0 1 1 8 2h4"/><path d="M9 5l3-3-3-3"/></svg>',
    },
  ];

  buttons.forEach((btn, idx) => {
    if (idx === 3 || idx === 6 || idx === 8) {
      const sep = document.createElement("div");
      sep.className = "align-sep";
      bar!.appendChild(sep);
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "align-btn";
    b.title = btn.title;
    b.setAttribute("aria-label", btn.title);
    b.innerHTML = btn.svg;
    b.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      onAction(btn.type);
    };
    bar!.appendChild(b);
  });

  container.appendChild(bar);
  return bar;
}

/**
 * Positions and displays the floating alignment toolbar above the selection bounding box.
 */
export function showAlignmentToolbar(
  toolbar: HTMLElement | null,
  container: HTMLElement,
  nodes: AlignableNode[],
  scale: { sx: number; sy: number },
  translate: { tx: number; ty: number },
): void {
  if (!toolbar || nodes.length < 2) {
    if (toolbar) {
      toolbar.style.opacity = "0";
      toolbar.style.display = "none";
    }
    return;
  }

  const minX = Math.min(...nodes.map((n) => n.x));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const minY = Math.min(...nodes.map((n) => n.y));

  // Graph space to container pixel space
  const screenCenterX = ((minX + maxX) / 2) * scale.sx + translate.tx;
  const screenTopY = minY * scale.sy + translate.ty - 12;

  toolbar.style.left = `${Math.max(120, Math.min(container.clientWidth - 120, screenCenterX))}px`;
  toolbar.style.top = `${Math.max(40, screenTopY)}px`;
  toolbar.style.display = "flex";
  toolbar.style.opacity = "1";
}
