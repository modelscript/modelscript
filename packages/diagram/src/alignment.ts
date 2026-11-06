// SPDX-License-Identifier: AGPL-3.0-or-later

export interface AlignableNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string | undefined;
  primaryParam?: { name: string; value: string } | null | undefined;
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
  | "rotate-cw"
  | "rotate-ccw"
  | "flip-h"
  | "flip-v"
  | "duplicate"
  | "properties"
  | "rename"
  | "edit-param"
  | "delete";

export type ArrowKeyDirection = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

export interface NudgeOptions {
  shiftKey?: boolean | undefined;
  altKey?: boolean | undefined;
  baseStep?: number | undefined;
}

export interface NudgeResultItem {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/**
 * Computes multi-gear keyboard arrow nudge deltas and updated positions for selected nodes.
 * - Normal (`Arrow`): `baseStep` (default `2` Modelica grid units)
 * - Coarse (`Shift + Arrow`): `baseStep * 5` (default `10` units / half-major grid)
 * - Fine (`Alt + Arrow`): `1` sub-grid unit
 */
export function computeNodeNudge(
  nodes: AlignableNode[],
  direction: ArrowKeyDirection,
  options?: NudgeOptions,
): NudgeResultItem[] {
  if (nodes.length === 0) return [];
  const base = options?.baseStep && options.baseStep > 0 ? options.baseStep : 2;
  const step = options?.altKey ? 1 : options?.shiftKey ? base * 5 : base;

  let dx = 0;
  let dy = 0;
  switch (direction) {
    case "ArrowUp":
      dy = -step;
      break;
    case "ArrowDown":
      dy = step;
      break;
    case "ArrowLeft":
      dx = -step;
      break;
    case "ArrowRight":
      dx = step;
      break;
  }

  return nodes.map((n) => ({
    id: n.id,
    x: Math.round((n.x + dx) * 100) / 100,
    y: Math.round((n.y + dy) * 100) / 100,
    dx,
    dy,
  }));
}

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

const TOOLBAR_ICONS = {
  alignLeft:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="2" height="14" rx="0.5"/><rect x="5" y="3" width="8" height="4" rx="1"/><rect x="5" y="9" width="5" height="4" rx="1"/></svg>',
  alignCenter:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="7" y="1" width="2" height="14" rx="0.5"/><rect x="3" y="3" width="10" height="4" rx="1"/><rect x="4.5" y="9" width="7" height="4" rx="1"/></svg>',
  alignRight:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="13" y="1" width="2" height="14" rx="0.5"/><rect x="3" y="3" width="8" height="4" rx="1"/><rect x="6" y="9" width="5" height="4" rx="1"/></svg>',
  alignTop:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="14" height="2" rx="0.5"/><rect x="3" y="5" width="4" height="8" rx="1"/><rect x="9" y="5" width="4" height="5" rx="1"/></svg>',
  alignMiddle:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="7" width="14" height="2" rx="0.5"/><rect x="3" y="3" width="4" height="10" rx="1"/><rect x="9" y="4.5" width="4" height="7" rx="1"/></svg>',
  alignBottom:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="13" width="14" height="2" rx="0.5"/><rect x="3" y="3" width="4" height="8" rx="1"/><rect x="9" y="6" width="4" height="5" rx="1"/></svg>',
  distributeH:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="2" height="14" rx="0.5"/><rect x="13" y="1" width="2" height="14" rx="0.5"/><rect x="6" y="4" width="4" height="8" rx="1"/></svg>',
  distributeV:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="14" height="2" rx="0.5"/><rect x="1" y="13" width="14" height="2" rx="0.5"/><rect x="4" y="6" width="8" height="4" rx="1"/></svg>',
  rotateCcw:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7A5.5 5.5 0 1 0 8 2.5H4"/><path d="M6.5 5L4 2.5 6.5 0"/></svg>',
  rotateCw:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 7A5.5 5.5 0 1 1 8 2.5h4"/><path d="M9.5 5L12 2.5 9.5 0"/></svg>',
  flipH:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="2" x2="8" y2="14" stroke-dasharray="2 2"/><polygon points="2,12 6,8 2,4" fill="currentColor"/><polygon points="14,12 10,8 14,4"/></svg>',
  flipV:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="8" x2="14" y2="8" stroke-dasharray="2 2"/><polygon points="4,2 8,6 12,2" fill="currentColor"/><polygon points="4,14 8,10 12,14"/></svg>',
  duplicate:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>',
  properties:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="4" x2="14" y2="4"/><circle cx="5" cy="4" r="1.7" fill="currentColor"/><line x1="2" y1="8" x2="14" y2="8"/><circle cx="11" cy="8" r="1.7" fill="currentColor"/><line x1="2" y1="12" x2="14" y2="12"/><circle cx="7" cy="12" r="1.7" fill="currentColor"/></svg>',
  delete:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4h11"/><path d="M5.5 4V2.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4"/><path d="M4 4l.8 9.5a1 1 0 0 0 1 1h4.4a1 1 0 0 0 1-1L12 4"/></svg>',
};

function escapeAttr(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderToolbarButtonHtml(btn: {
  type: AlignmentType;
  title: string;
  svg: string;
  danger?: boolean | undefined;
}): string {
  const cls = btn.danger ? "align-btn align-btn-danger" : "align-btn";
  const title = escapeAttr(btn.title);
  return `<button type="button" class="${cls}" title="${title}" aria-label="${title}" data-action="${btn.type}" data-align="${btn.type}">${btn.svg}</button>`;
}

function wireToolbarDelegation(bar: HTMLElement, onAction: (type: AlignmentType) => void): void {
  bar.onclick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || target.tagName === "INPUT") return;
    const btn = target.closest?.("[data-action], [data-align]") as HTMLElement | null;
    if (!btn) return;
    const action = (btn.getAttribute("data-action") || btn.getAttribute("data-align")) as AlignmentType | null;
    if (action) {
      e.stopPropagation();
      e.preventDefault();
      onAction(action);
    }
  };
}

function populateSingleNodeToolbar(
  bar: HTMLElement,
  node: AlignableNode,
  onAction: (type: AlignmentType) => void,
): void {
  const displayName = escapeAttr(node.name || node.id);
  const parts: string[] = [
    `<button type="button" class="align-chip align-chip-name" title="Rename Component (F2)" data-action="rename" data-align="rename">${displayName}</button>`,
  ];

  if (node.primaryParam && node.primaryParam.name) {
    const pName = escapeAttr(node.primaryParam.name);
    const pVal = escapeAttr(node.primaryParam.value);
    parts.push(
      `<button type="button" class="align-chip align-chip-param" title="Quick Edit ${pName} Value" data-action="edit-param" data-align="edit-param">${pName}=${pVal}</button>`,
    );
  }

  parts.push('<div class="align-sep"></div>');
  parts.push(
    renderToolbarButtonHtml({
      type: "rotate-ccw",
      title: "Rotate 90° Counter-Clockwise (Shift+R)",
      svg: TOOLBAR_ICONS.rotateCcw,
    }),
  );
  parts.push(
    renderToolbarButtonHtml({
      type: "rotate-cw",
      title: "Rotate 90° Clockwise (R)",
      svg: TOOLBAR_ICONS.rotateCw,
    }),
  );
  parts.push(renderToolbarButtonHtml({ type: "flip-h", title: "Flip Horizontal (H)", svg: TOOLBAR_ICONS.flipH }));
  parts.push(renderToolbarButtonHtml({ type: "flip-v", title: "Flip Vertical (V)", svg: TOOLBAR_ICONS.flipV }));
  parts.push('<div class="align-sep"></div>');
  parts.push(
    renderToolbarButtonHtml({
      type: "duplicate",
      title: "Duplicate Component (Ctrl+D)",
      svg: TOOLBAR_ICONS.duplicate,
    }),
  );
  parts.push(
    renderToolbarButtonHtml({
      type: "properties",
      title: "Inspect Properties (Enter)",
      svg: TOOLBAR_ICONS.properties,
    }),
  );
  parts.push(
    renderToolbarButtonHtml({
      type: "delete",
      title: "Delete Component (Del)",
      svg: TOOLBAR_ICONS.delete,
      danger: true,
    }),
  );

  bar.innerHTML = parts.join("");
  wireToolbarDelegation(bar, onAction);
}

function populateMultiNodeToolbar(
  bar: HTMLElement,
  count: number,
  onAction: (type: AlignmentType) => void,
): void {
  const parts: string[] = [
    `<span class="align-badge-count">${count} selected</span>`,
    '<div class="align-sep"></div>',
  ];

  const buttons: { type: AlignmentType; title: string; svg: string; danger?: boolean; sepBefore?: boolean }[] = [
    { type: "align-left", title: "Align Left (Alt+L)", svg: TOOLBAR_ICONS.alignLeft },
    { type: "align-center", title: "Align Center Horizontally (Alt+C)", svg: TOOLBAR_ICONS.alignCenter },
    { type: "align-right", title: "Align Right (Alt+R)", svg: TOOLBAR_ICONS.alignRight },
    { type: "align-top", title: "Align Top (Alt+T)", svg: TOOLBAR_ICONS.alignTop, sepBefore: true },
    { type: "align-middle", title: "Align Middle Vertically (Alt+M)", svg: TOOLBAR_ICONS.alignMiddle },
    { type: "align-bottom", title: "Align Bottom (Alt+B)", svg: TOOLBAR_ICONS.alignBottom },
    {
      type: "distribute-horizontal",
      title: "Distribute Horizontally (Alt+H)",
      svg: TOOLBAR_ICONS.distributeH,
      sepBefore: true,
    },
    { type: "distribute-vertical", title: "Distribute Vertically (Alt+V)", svg: TOOLBAR_ICONS.distributeV },
    {
      type: "rotate-ccw",
      title: "Rotate 90° Counter-Clockwise (Shift+R)",
      svg: TOOLBAR_ICONS.rotateCcw,
      sepBefore: true,
    },
    { type: "rotate-cw", title: "Rotate 90° Clockwise (R)", svg: TOOLBAR_ICONS.rotateCw },
    { type: "duplicate", title: "Duplicate Selected (Ctrl+D)", svg: TOOLBAR_ICONS.duplicate },
    { type: "delete", title: "Delete Selected (Del)", svg: TOOLBAR_ICONS.delete, danger: true },
  ];

  for (const btn of buttons) {
    if (btn.sepBefore) parts.push('<div class="align-sep"></div>');
    parts.push(renderToolbarButtonHtml(btn));
  }

  bar.innerHTML = parts.join("");
  wireToolbarDelegation(bar, onAction);
}

const toolbarCallbacks = new WeakMap<HTMLElement, (type: AlignmentType) => void>();

/**
 * Creates or retrieves the floating Contextual Edit & CAD Alignment toolbar in the DOM.
 */
export function ensureAlignmentToolbar(
  container: HTMLElement,
  onAction: (type: AlignmentType) => void,
): HTMLElement | null {
  if (typeof document === "undefined" || !container) return null;
  let bar = container.querySelector("#modelscript-alignment-toolbar") as HTMLElement | null;
  if (bar) {
    toolbarCallbacks.set(bar, onAction);
    wireToolbarDelegation(bar, (t) => toolbarCallbacks.get(bar!)?.(t));
    return bar;
  }

  bar = document.createElement("div");
  bar.id = "modelscript-alignment-toolbar";
  bar.className = "modelscript-alignment-toolbar";
  bar.style.position = "absolute";
  bar.style.display = "none";
  bar.style.zIndex = "1000";
  bar.style.transform = "translate(-50%, -100%)";
  bar.style.transition = "opacity 0.14s ease, transform 0.14s ease";
  bar.style.opacity = "0";

  toolbarCallbacks.set(bar, onAction);
  populateMultiNodeToolbar(bar, 2, (t) => toolbarCallbacks.get(bar!)?.(t));

  container.appendChild(bar);
  return bar;
}

/**
 * Positions and displays the contextual floating edit bar above (or below, if near top edge)
 * the selected node or multi-node bounding box.
 */
export function showAlignmentToolbar(
  toolbar: HTMLElement | null,
  container: HTMLElement,
  nodes: AlignableNode[],
  scale: { sx: number; sy: number },
  translate: { tx: number; ty: number },
  options?: { hidden?: boolean | undefined },
): void {
  if (!toolbar || nodes.length === 0 || options?.hidden) {
    if (toolbar) {
      toolbar.style.opacity = "0";
      toolbar.style.display = "none";
      toolbar.classList?.remove?.("visible");
    }
    return;
  }

  // Do not clobber an active inline parameter input inside the toolbar
  const hasActiveInput = Boolean(toolbar.querySelector?.(".align-param-input"));
  if (!hasActiveInput) {
    const onAction = (t: AlignmentType) => toolbarCallbacks.get(toolbar)?.(t);
    if (nodes.length === 1) {
      const single = nodes[0]!;
      const paramStr = single.primaryParam?.name ? `${single.primaryParam.name}=${single.primaryParam.value}` : "";
      const modeKey = `single:${single.name ?? single.id}:${paramStr}`;
      if (toolbar.getAttribute?.("data-mode-key") !== modeKey) {
        populateSingleNodeToolbar(toolbar, single, onAction);
        toolbar.setAttribute?.("data-mode-key", modeKey);
      }
      if (toolbar.dataset) toolbar.dataset["mode"] = modeKey;
    } else {
      const modeKey = `multi:${nodes.length}`;
      if (toolbar.getAttribute?.("data-mode-key") !== modeKey) {
        populateMultiNodeToolbar(toolbar, nodes.length, onAction);
        toolbar.setAttribute?.("data-mode-key", modeKey);
      }
      if (toolbar.dataset) toolbar.dataset["mode"] = modeKey;
    }
  }

  const minX = Math.min(...nodes.map((n) => n.x));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));

  // Graph space to container pixel space
  const screenCenterX = ((minX + maxX) / 2) * scale.sx + translate.tx;
  const screenTopY = minY * scale.sy + translate.ty - 14;
  const screenBottomY = maxY * scale.sy + translate.ty + 14;

  const containerW = container.clientWidth > 0 ? container.clientWidth : 800;
  const containerH = container.clientHeight > 0 ? container.clientHeight : 600;
  const halfBarW = nodes.length === 1 ? 150 : 210;

  toolbar.style.left = `${Math.max(halfBarW, Math.min(containerW - halfBarW, screenCenterX))}px`;

  // Flip below the component if it is too close to the top of the viewport
  if (screenTopY < 48) {
    toolbar.style.top = `${Math.min(containerH - 44, Math.max(12, screenBottomY))}px`;
    toolbar.style.transform = "translate(-50%, 0%)";
  } else {
    toolbar.style.top = `${Math.max(40, screenTopY)}px`;
    toolbar.style.transform = "translate(-50%, -100%)";
  }

  toolbar.style.display = "flex";
  toolbar.style.opacity = "1";
  toolbar.classList?.add?.("visible");
}

