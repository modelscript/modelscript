// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeNodeNudge, type AlignableNode, type AlignmentType, type ArrowKeyDirection } from "./alignment.js";
import { getConnectedEdges, rerouteEdgeOrthogonal, scheduleUpdateSolderDots } from "./canvas-edge-routing.js";
import type { NodeEditingController } from "./canvas-node-editing.js";
import type { PlacementAndWireController } from "./canvas-placement-wire.js";
import {
  enqueueDiagramAction,
  getActiveGraph,
  getOptionsForGraph,
  getPropertyCacheForGraph,
  getReadOnlyForGraph,
  postMessageToHost,
  setSelectedNodeIdForGraph,
  showProperties,
} from "./canvas-state.js";
import type { CanvasInteractionFlags, Cell, DiagramWindow, Edge, Graph, Node } from "./canvas-types.js";
import { hideContextMenu, showContextMenu } from "./context-menu.js";
import { isEphemeralDiagramNode } from "./drop-placeholder.js";
import { isGraphLayoutEditable } from "./graph-state.js";
import { defaultInteractiveStateManager } from "./interactive.js";
import { isMinimapOpen, toggleMinimapHud, updateMinimapHud } from "./minimap.js";
import { translateConnectedEdgeStubs } from "./port-router.js";
import { syncAllNodeSelectionBoxes } from "./selection-handles.js";
import * as Spinner from "./spinner.js";

/**
 * Attaches desktop CAD context menus, keyboard shortcuts (arrow-key 3-gear nudging,
 * undo/redo, copy/cut/paste, zoom, rotate/flip, alignment, Spacebar hand-pan mode),
 * interactive widget click/momentary bindings, and double-click drill-down navigation.
 * Returns a cleanup callback invoked on diagram disposal.
 */
export function attachCanvasUiHandlers(params: {
  graph: Graph;
  container: HTMLElement;
  minimapHud: HTMLElement | null;
  editing: NodeEditingController;
  placementAndWire: PlacementAndWireController;
  flags: CanvasInteractionFlags;
  getSelectionContainer: () => HTMLElement | undefined;
  onAutoLayoutFallback: (g: Graph) => Promise<boolean>;
  onGroupSelected: (g: Graph) => boolean;
  onUngroupSelected: (g: Graph) => boolean;
}): () => void {
  const {
    graph: g,
    container,
    minimapHud,
    editing,
    placementAndWire,
    flags,
    getSelectionContainer,
    onAutoLayoutFallback,
    onGroupSelected,
    onUngroupSelected,
  } = params;

  const win = typeof window !== "undefined" ? (window as unknown as DiagramWindow) : null;

  // ── Desktop CAD Context Menus ──
  g.on("node:contextmenu", ({ node, e }: { node: Node; e: MouseEvent }) => {
    if (getOptionsForGraph(g)?.disableBuiltinContextMenu) return;
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!node || isEphemeralDiagramNode(node.id)) return;

    if (!g.isSelected?.(node)) {
      g.cleanSelection?.();
      g.select?.(node);
    }

    const nodeName = (node.getData?.()?.["name"] as string) || node.id;
    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      container,
      items: [
        {
          label: "Rotate 90° Clockwise",
          shortcut: "R",
          action: () => editing.rotateSelectedNodes(90, g),
        },
        {
          label: "Rotate 90° Counter-CW",
          shortcut: "Shift+R",
          action: () => editing.rotateSelectedNodes(-90, g),
        },
        {
          label: "Flip Horizontal",
          shortcut: "H",
          action: () => editing.flipSelectedNodes("x", g),
        },
        {
          label: "Flip Vertical",
          shortcut: "V",
          action: () => editing.flipSelectedNodes("y", g),
        },
        { type: "separator" },
        {
          label: "Rename Component…",
          shortcut: "F2",
          action: () => editing.startInlineNodeEdit(node),
        },
        {
          label: "Duplicate Component",
          shortcut: "Ctrl+D",
          action: () => editing.duplicateSelectedNodes(g),
        },
        {
          label: "Group Selection",
          shortcut: "Ctrl+G",
          action: () => {
            onGroupSelected(g);
          },
        },
        {
          label: "Ungroup",
          shortcut: "Ctrl+Shift+G",
          action: () => {
            onUngroupSelected(g);
          },
        },
        {
          label: "Inspect Properties",
          shortcut: "Enter",
          action: () => {
            postMessageToHost({ type: "getProperties", componentName: nodeName }, g);
          },
        },
        { type: "separator" },
        {
          label: "Delete Component",
          shortcut: "Del",
          danger: true,
          action: () => editing.deleteSelectedCells(g),
        },
      ],
    });
  });

  g.on("edge:contextmenu", ({ edge, e }: { edge: Edge; e: MouseEvent }) => {
    if (getOptionsForGraph(g)?.disableBuiltinContextMenu) return;
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!edge || !edge.isEdge()) return;

    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      container,
      items: [
        {
          label: "Re-route Orthogonal",
          action: () => {
            rerouteEdgeOrthogonal(edge, g);
          },
        },
        {
          label: "Clear Bends / Vertices",
          action: () => {
            edge.setVertices([]);
            rerouteEdgeOrthogonal(edge, g);
          },
        },
        { type: "separator" },
        {
          label: "Delete Connection",
          shortcut: "Del",
          danger: true,
          action: () => {
            const src = edge.getSource() as { cell?: string; port?: string } | undefined;
            const tgt = edge.getTarget() as { cell?: string; port?: string } | undefined;
            if (src?.cell && src?.port && tgt?.cell && tgt?.port) {
              enqueueDiagramAction(
                { type: "disconnect", source: `${src.cell}.${src.port}`, target: `${tgt.cell}.${tgt.port}` },
                g,
              );
            }
            g.removeCell?.(edge);
            scheduleUpdateSolderDots(g);
          },
        },
      ],
    });
  });

  g.on("blank:contextmenu", ({ e }: { e: MouseEvent }) => {
    if (getOptionsForGraph(g)?.disableBuiltinContextMenu) return;
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      container,
      items: [
        {
          label: "Zoom to Fit",
          shortcut: "Shift+1",
          action: () => {
            g.zoomToFit({ maxScale: 1, padding: 24 });
          },
        },
        {
          label: "Reset Zoom (100%)",
          shortcut: "Ctrl+0",
          action: () => {
            if (typeof g.zoomTo === "function") g.zoomTo(1);
            else g.zoom(1, { absolute: true });
          },
        },
        { type: "separator" },
        {
          label: "Auto-layout Diagram",
          action: () => {
            const opts = getOptionsForGraph(g);
            if (opts?.onAutoLayout) {
              opts.onAutoLayout();
            } else {
              void onAutoLayoutFallback(g);
            }
          },
        },
        {
          label: isMinimapOpen(container) ? "Hide Minimap" : "Show Minimap",
          shortcut: "M",
          action: () => {
            toggleMinimapHud(container);
            updateMinimapHud(minimapHud, g);
          },
        },
      ],
    });
  });

  g.on("blank:click", () => {
    hideContextMenu(container);
    try {
      const edges = typeof g.getEdges === "function" ? g.getEdges() : [];
      for (const e of edges) {
        if (!g.isSelected?.(e)) {
          e.removeTools?.();
        }
      }
    } catch {}
  });

  const onAltKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Alt" || e.altKey) flags.isAltPressed = true;
  };
  const onAltKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Alt" || !e.altKey) flags.isAltPressed = false;
  };

  let nudgeCommitTimeout: ReturnType<typeof setTimeout> | null = null;
  const pendingNudgeNodeIds = new Set<string>();

  // Keyboard shortcuts: Delete, Arrow Key Shifting, Flip, Duplicate, Rename, Align, Zoom
  const onDocKeyDown = (e: KeyboardEvent) => {
    if (g.disposed) return;

    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        (active as HTMLElement).isContentEditable ||
        Boolean((active as HTMLElement).closest?.(".monaco-editor")))
    ) {
      return;
    }

    // Scope keyboard shortcuts to the focused or hovered diagram container (prevents cross-instance leaks & toolbar steals)
    const isContainerFocusedOrHovered = Boolean(
      (active && container.contains(active)) ||
      (typeof container.matches === "function" && container.matches(":hover")) ||
      (active === document.body && getActiveGraph() === g),
    );
    if (!isContainerFocusedOrHovered) return;

    if (e.key === "Escape") {
      g.fsm?.cancel();
      if (
        g.getSelectedCells().length > 0 &&
        !placementAndWire.isPlacementActive() &&
        !placementAndWire.isWireToolActive()
      ) {
        g.cleanSelection?.();
        setSelectedNodeIdForGraph(g, null);
        getOptionsForGraph(g)?.onSelect?.(null);
      }
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      if (getActiveGraph() === g || (active && container.contains(active))) {
        editing.deleteSelectedCells(g);
      }
      return;
    }

    if (getActiveGraph() === g || (active && container.contains(active))) {
      const nav = navigator as unknown as {
        platform?: string | undefined;
        userAgent?: string | undefined;
        userAgentData?: { platform?: string | undefined } | undefined;
      };
      const platform = (nav.userAgentData?.platform || nav.platform || nav.userAgent || "").toUpperCase();
      const isMac = platform.indexOf("MAC") >= 0;
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // Ctrl/Cmd+A: Select all non-ephemeral nodes
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const allNodes = g.getNodes().filter((n: Cell) => !isEphemeralDiagramNode(n.id));
        if (allNodes.length > 0) {
          g.cleanSelection?.();
          g.select?.(allNodes);
        }
        return;
      }

      // ── 3-Gear Precision Arrow Key Shifting (Normal: 2px, Shift: 10px, Alt: 1px) ──
      if (!mod && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const selectedNodes = g
          .getSelectedCells()
          .filter((c: Cell) => typeof c.isNode === "function" && c.isNode() && !isEphemeralDiagramNode(c.id)) as Node[];
        if (selectedNodes.length > 0 && (!getReadOnlyForGraph(g) || isGraphLayoutEditable(g))) {
          e.preventDefault();
          const alignable: AlignableNode[] = selectedNodes.map((n: Node) => {
            const p = n.getPosition();
            const s = n.getSize();
            return { id: n.id, x: p.x, y: p.y, width: s.width, height: s.height };
          });
          const nudges = computeNodeNudge(alignable, e.key as ArrowKeyDirection, {
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            baseStep: 2,
          });
          if (nudges.length > 0) {
            const stepDx = nudges[0]!.dx;
            const stepDy = nudges[0]!.dy;
            const { accumDx, accumDy } = editing.addNudgeDelta(stepDx, stepDy);

            flags.isSnappingPortAlignment = true;
            g.batchUpdate("nudge", () => {
              for (const u of nudges) {
                const node = g.getCellById(u.id) as Node;
                if (node && typeof node.isNode === "function" && node.isNode()) {
                  node.setPosition(u.x, u.y);
                  translateConnectedEdgeStubs(g, node, u.dx, u.dy);
                  pendingNudgeNodeIds.add(u.id);
                }
              }
            });
            flags.isSnappingPortAlignment = false;

            syncAllNodeSelectionBoxes(g, getSelectionContainer());
            editing.syncAlignmentToolbar();
            editing.showNudgeHud(g, selectedNodes, accumDx, accumDy);
            scheduleUpdateSolderDots(g);

            if (nudgeCommitTimeout) clearTimeout(nudgeCommitTimeout);
            nudgeCommitTimeout = setTimeout(() => {
              if (g.disposed) return;
              const moveItems: Record<string, unknown>[] = [];
              pendingNudgeNodeIds.forEach((id) => {
                const n = g.getCellById(id) as Node | null;
                if (n && typeof n.isNode === "function" && n.isNode()) {
                  const p = n.getPosition();
                  const s = n.getSize();
                  const r = n.getAngle?.() || 0;
                  const edges = getConnectedEdges(g, n);
                  const name = (n.getData?.()?.["name"] as string) || n.id;
                  moveItems.push({
                    name,
                    x: p.x,
                    y: p.y,
                    width: s.width,
                    height: s.height,
                    rotation: r,
                    edges,
                  });
                }
              });
              pendingNudgeNodeIds.clear();
              nudgeCommitTimeout = null;
              if (moveItems.length > 0) {
                enqueueDiagramAction({ type: "move", items: moveItems }, g);
              }
            }, 150);
          }
          return;
        }
      }

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        Spinner.show();
        if (e.shiftKey) {
          postMessageToHost({ type: "redo" }, g);
        } else {
          postMessageToHost({ type: "undo" }, g);
        }
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        Spinner.show();
        postMessageToHost({ type: "redo" }, g);
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        editing.duplicateSelectedNodes(g);
      } else if (mod && e.key.toLowerCase() === "c") {
        if (editing.copySelectedNodes(g)) {
          e.preventDefault();
        }
      } else if (mod && e.key.toLowerCase() === "x") {
        if (editing.copySelectedNodes(g)) {
          e.preventDefault();
          editing.deleteSelectedCells(g);
        }
      } else if (mod && e.key.toLowerCase() === "v") {
        if (editing.pasteSelectedNodes(g)) {
          e.preventDefault();
        }
      } else if (mod && e.key.toLowerCase() === "g") {
        const handled = e.shiftKey ? onUngroupSelected(g) : onGroupSelected(g);
        if (handled) {
          e.preventDefault();
        }
      } else if (mod && (e.key === "=" || e.key === "+" || e.code === "Equal" || e.code === "NumpadAdd")) {
        e.preventDefault();
        const current = g.zoom();
        const next = Math.min(3, Math.round((current + 0.15) * 100) / 100);
        if (typeof g.zoomTo === "function") g.zoomTo(next);
        else g.zoom(next, { absolute: true });
      } else if (mod && (e.key === "-" || e.key === "_" || e.code === "Minus" || e.code === "NumpadSubtract")) {
        e.preventDefault();
        const current = g.zoom();
        const next = Math.max(0.1, Math.round((current - 0.15) * 100) / 100);
        if (typeof g.zoomTo === "function") g.zoomTo(next);
        else g.zoom(next, { absolute: true });
      } else if (mod && (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0")) {
        e.preventDefault();
        if (typeof g.zoomTo === "function") g.zoomTo(1);
        else g.zoom(1, { absolute: true });
      } else if ((mod && (e.key === "1" || e.code === "Digit1")) || (e.shiftKey && (e.key === "1" || e.key === "!"))) {
        e.preventDefault();
        g.zoomToFit({ maxScale: 1, padding: 24 });
      } else if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleMinimapHud(container);
        updateMinimapHud(minimapHud, g);
      } else if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.repeat) return;
        e.preventDefault();
        editing.rotateSelectedNodes(e.shiftKey ? -90 : 90, g);
      } else if ((e.key === "h" || e.key === "H") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.repeat) return;
        e.preventDefault();
        editing.flipSelectedNodes("x", g);
      } else if ((e.key === "v" || e.key === "V") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.repeat) return;
        e.preventDefault();
        editing.flipSelectedNodes("y", g);
      } else if ((e.key === "[" || e.key === "]") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const allNodes = g
          .getNodes()
          .filter((n: Cell) => !isEphemeralDiagramNode(n.id))
          .sort((a: Cell, b: Cell) => a.id.localeCompare(b.id));
        if (allNodes.length > 0) {
          e.preventDefault();
          const currentSelected = g
            .getSelectedCells()
            .find((c: Cell) => typeof c.isNode === "function" && c.isNode() && !isEphemeralDiagramNode(c.id));
          const curIdx = currentSelected ? allNodes.findIndex((n: Cell) => n.id === currentSelected.id) : -1;
          const delta = e.key === "]" ? 1 : -1;
          const nextIdx =
            curIdx === -1
              ? delta > 0
                ? 0
                : allNodes.length - 1
              : (curIdx + delta + allNodes.length) % allNodes.length;
          const nextNode = allNodes[nextIdx]!;
          g.cleanSelection?.();
          g.select?.(nextNode);
        }
      } else if (e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const selectedNodes = g
          .getSelectedCells()
          .filter((c: Cell) => typeof c.isNode === "function" && c.isNode() && !isEphemeralDiagramNode(c.id)) as Node[];
        if (selectedNodes.length === 1) {
          e.preventDefault();
          editing.startInlineNodeEdit(selectedNodes[0]!);
        }
      } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const selectedNodes = g
          .getSelectedCells()
          .filter((c: Cell) => typeof c.isNode === "function" && c.isNode() && !isEphemeralDiagramNode(c.id)) as Node[];
        if (selectedNodes.length === 1) {
          e.preventDefault();
          const first = selectedNodes[0]!;
          const nodeName = (first.getData?.()?.["name"] as string) || first.id;
          const cachedProps = getPropertyCacheForGraph(g).get(first.id);
          if (cachedProps) {
            showProperties({ id: first.id, properties: cachedProps }, g);
          } else {
            showProperties({ id: first.id, properties: first.getData?.()?.properties, isLoading: true }, g);
            postMessageToHost({ type: "getProperties", componentName: nodeName }, g);
          }
        }
      } else if (e.altKey && !e.ctrlKey && !e.metaKey) {
        // Use e.code so Option+letter works on macOS (where e.key produces dead/accent characters)
        const alignCodeMap: Record<string, AlignmentType> = {
          KeyL: "align-left",
          KeyC: "align-center",
          KeyR: "align-right",
          KeyT: "align-top",
          KeyM: "align-middle",
          KeyB: "align-bottom",
          KeyH: "distribute-horizontal",
          KeyV: "distribute-vertical",
        };
        const alignType = alignCodeMap[e.code];
        if (alignType) {
          const btn = editing.alignmentToolbar?.querySelector(
            `[data-action="${alignType}"], [data-align="${alignType}"]`,
          ) as HTMLButtonElement | null | undefined;
          if (btn) {
            e.preventDefault();
            btn.click();
          }
        }
      }
    }
  };

  let onSpaceKeyDown: ((e: KeyboardEvent) => void) | null = null;
  let onSpaceKeyUp: ((e: KeyboardEvent) => void) | null = null;
  let onWindowBlur: (() => void) | null = null;

  if (typeof document !== "undefined") {
    document.addEventListener("keydown", onAltKeyDown);
    document.addEventListener("keyup", onAltKeyUp);
    document.addEventListener("keydown", onDocKeyDown);

    // ── CAD Spacebar Hand Pan Mode (wired directly into CanvasPointerFSM so pointerdown never conflicts) ──
    let isSpacePressed = false;

    const isTargetEditable = (el: Element | null): boolean => {
      if (!el) return false;
      const htmlEl = el as HTMLElement;
      return Boolean(
        htmlEl.tagName === "INPUT" ||
        htmlEl.tagName === "TEXTAREA" ||
        htmlEl.tagName === "SELECT" ||
        htmlEl.isContentEditable ||
        htmlEl.closest?.(".monaco-editor, [contenteditable='true'], input, textarea, select"),
      );
    };

    onSpaceKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " || e.code === "Space") {
        if (isTargetEditable(document.activeElement) || isTargetEditable(e.target as Element)) {
          return;
        }
        const isOverContainer = Boolean(
          (typeof container.matches === "function" && container.matches(":hover")) ||
          (e.target && container.contains(e.target as unknown as globalThis.Node)) ||
          (document.activeElement && container.contains(document.activeElement)),
        );
        if (!isOverContainer) {
          return;
        }
        if (!isSpacePressed) {
          isSpacePressed = true;
          g.fsm?.setPanToolActive(true);
          container.classList.add("ms-hand-panning");
        }
        e.preventDefault();
      }
    };

    onSpaceKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " || e.code === "Space") {
        isSpacePressed = false;
        g.fsm?.setPanToolActive(false);
        container.classList.remove("ms-hand-panning");
        container.classList.remove("ms-hand-panning-active");
      }
    };

    onWindowBlur = () => {
      isSpacePressed = false;
      flags.isAltPressed = false;
      g.fsm?.setPanToolActive(false);
      container.classList.remove("ms-hand-panning");
      container.classList.remove("ms-hand-panning-active");
    };

    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("keydown", onSpaceKeyDown);
    document.addEventListener("keyup", onSpaceKeyUp);
  }

  g.on("node:mousedown", ({ node }: { node: Node }) => {
    if (isEphemeralDiagramNode(node.id)) return;
    const interactiveBindings = node.getData()?.interactive;
    if (Array.isArray(interactiveBindings)) {
      for (const binding of interactiveBindings) {
        if (binding.action === "momentary") {
          const action = defaultInteractiveStateManager.handleInteraction(node, binding, "mousedown");
          if (action) enqueueDiagramAction(action, g);
        }
      }
    }
  });

  g.on("node:mouseup", ({ node }: { node: Node }) => {
    if (isEphemeralDiagramNode(node.id)) return;
    const interactiveBindings = node.getData()?.interactive;
    if (Array.isArray(interactiveBindings)) {
      for (const binding of interactiveBindings) {
        if (binding.action === "momentary") {
          const action = defaultInteractiveStateManager.handleInteraction(node, binding, "mouseup");
          if (action) enqueueDiagramAction(action, g);
        }
      }
    }
  });

  g.on("node:click", ({ node }: { node: Node }) => {
    if (g.disposed) return;
    const opts = getOptionsForGraph(g);
    if (isEphemeralDiagramNode(node.id)) {
      setSelectedNodeIdForGraph(g, null);
      if (opts?.onSelect) opts.onSelect(null);
      return;
    }
    setSelectedNodeIdForGraph(g, node.id);
    const data = node.getData();

    // Module link button single-click navigation (e.g. 'More on Passive Elements' in PSCAD library)
    if (data?.kind === "module-link" && data.targetModule) {
      postMessageToHost(
        {
          type: "navigateTo",
          className: data.targetModule,
          diagramType: "All",
        },
        g,
      );
      return;
    }

    // Process interactive bindings on click (toggle, numeric, selector, faceplate)
    const interactiveBindings = data?.interactive;
    if (Array.isArray(interactiveBindings)) {
      for (const binding of interactiveBindings) {
        if (binding.action === "toggle" || binding.action === "faceplate") {
          const action = defaultInteractiveStateManager.handleInteraction(node, binding, "click");
          if (action) enqueueDiagramAction(action, g);
        } else if (binding.action === "numeric" || binding.action === "slider") {
          if (win && typeof win.prompt === "function") {
            const current = defaultInteractiveStateManager.getValue(node.id, binding.variableName, binding.min ?? 0);
            const unitLabel = binding.unit ? ` [${binding.unit}]` : "";
            const rangeLabel =
              binding.min !== undefined && binding.max !== undefined ? ` (${binding.min} - ${binding.max})` : "";
            const input = win.prompt(
              `Set ${binding.label ?? binding.variableName}${unitLabel}${rangeLabel}:`,
              String(current),
            );
            if (input !== null) {
              const action = defaultInteractiveStateManager.handleInteraction(node, binding, "input", input);
              if (action) enqueueDiagramAction(action, g);
            }
          }
        }
      }
    }

    // Show properties panel immediately with lightweight data, then request full properties
    const cachedProps = getPropertyCacheForGraph(g).get(node.id);
    if (cachedProps) {
      showProperties({ id: node.id, properties: cachedProps }, g);
    } else {
      // Show panel with lightweight data (className, name, description) + loading indicator
      showProperties({ id: node.id, properties: data?.properties, isLoading: true }, g);
      // Request full properties from host on-demand
      postMessageToHost({ type: "getProperties", componentName: node.id }, g);
    }

    // Reveal the source location of the clicked element in the text editor
    const props = data?.properties;
    if (props?.sourceRange) {
      postMessageToHost(
        {
          type: "revealSource",
          startOffset: props.sourceRange.startOffset,
          endOffset: props.sourceRange.endOffset,
        },
        g,
      );
    }

    // Only pan to the clicked node if it is clipped or outside the comfortable visible viewport
    const bbox = node.getBBox();
    const scale = g.scale().sx;
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;

    const paddingRight = 300;
    const containerRect = g.container.getBoundingClientRect();
    const visibleWidth = Math.max(200, containerRect.width - paddingRight);
    const { tx: ctx, ty: cty } = g.translate();

    const screenLeft = bbox.x * scale + ctx;
    const screenTop = bbox.y * scale + cty;
    const screenRight = (bbox.x + bbox.width) * scale + ctx;
    const screenBottom = (bbox.y + bbox.height) * scale + cty;
    const margin = 36;
    const isComfortablyVisible =
      screenLeft >= margin &&
      screenTop >= margin &&
      screenRight <= visibleWidth - margin &&
      screenBottom <= containerRect.height - margin;

    if (!isComfortablyVisible && containerRect.width > 0 && containerRect.height > 0) {
      const targetTx = visibleWidth / 2 - cx * scale;
      const targetTy = containerRect.height / 2 - cy * scale;
      const duration = 250;
      const startTime = performance.now();

      const animate = (time: number) => {
        const elapsed = time - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3); // cubic ease-out
        g.translate(ctx + (targetTx - ctx) * ease, cty + (targetTy - cty) * ease);
        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);
    }
  });

  // ── Double-click navigation: drill into child diagram views ──
  // E.g., double-click a StateDefinition in BDD → open StateMachine view for it.
  g.on("node:dblclick", ({ node }: { node: Node }) => {
    if (isEphemeralDiagramNode(node.id)) return;
    const data = node.getData();
    if (data?.kind === "module-link" && data.targetModule) {
      postMessageToHost(
        {
          type: "navigateTo",
          className: data.targetModule,
          diagramType: "All",
        },
        g,
      );
      return;
    }
    const props = data?.properties;
    if (!props?.ruleName) return;

    // Determine which diagram type to navigate to based on the element's type
    const navigationMap: Record<string, string> = {
      PartDefinition: "IBD",
      PartUsage: "IBD",
      StateDefinition: "StateMachine",
      StateUsage: "StateMachine",
      ActionDefinition: "Activity",
      ActionUsage: "Activity",
      UseCaseDefinition: "UseCase",
      UseCaseUsage: "UseCase",
      RequirementDefinition: "Requirement",
      RequirementUsage: "Requirement",
      ConstraintDefinition: "Parametric",
      ConstraintUsage: "Parametric",
      Package: "Package",
    };

    const targetDiagramType = props?.ruleName ? navigationMap[props.ruleName] : undefined;
    if (targetDiagramType) {
      postMessageToHost(
        {
          type: "navigateTo",
          className: props.description, // the element name
          diagramType: targetDiagramType,
        },
        g,
      );
      return;
    }

    // Leaf component: trigger inline canvas rename
    editing.startInlineNodeEdit(node);
  });

  g.on("blank:click", () => {
    setSelectedNodeIdForGraph(g, null);
    const opts = getOptionsForGraph(g);
    if (opts?.onSelect) opts.onSelect(null);
  });

  return () => {
    if (nudgeCommitTimeout) {
      clearTimeout(nudgeCommitTimeout);
      nudgeCommitTimeout = null;
    }
    hideContextMenu(container);
    if (typeof window !== "undefined") {
      if (onWindowBlur) window.removeEventListener("blur", onWindowBlur);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("keydown", onAltKeyDown);
      document.removeEventListener("keyup", onAltKeyUp);
      document.removeEventListener("keydown", onDocKeyDown);
      if (onSpaceKeyDown) document.removeEventListener("keydown", onSpaceKeyDown);
      if (onSpaceKeyUp) document.removeEventListener("keyup", onSpaceKeyUp);
    }
  };
}
