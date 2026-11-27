// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DOMAIN_FILTERS,
  GALLERY_COMPONENTS,
  type EngineeringDomainId,
  type GalleryComponentItem,
} from "./componentGalleryCatalog.js";
import { resolveDiagramLanguageTheme } from "./diagram-language-theme.js";
import { resolveRealisticComponentKind, type RealisticComponentKind } from "./realistic-components-3d.js";
import { categoryToSpatialDomain, inferCatalogItemPorts, type SpatialPortDomain } from "./spatial-diagram-state.js";

/* -------------------------------------------------------------------------- */
/*  Spatial Dimensions & Ergonomic Constants (Meters, Standing VR Frame)      */
/* -------------------------------------------------------------------------- */

/** Active foreground frosted-glass panel dimensions (m) — crisp & Quest-2 legible. */
export const GLASS_PANEL_W = 0.96;
export const GLASS_PANEL_H = 0.68;
export const GLASS_PANEL_CURVE_DEPTH = 0.032;

/** Canvas resolution for the active foreground glass panel texture. */
export const GLASS_CANVAS_W = 1280;
export const GLASS_CANVAS_H = 906;

/** Foreground panel center in stage-local standing space (comfortable eye/chest height). */
export const GLASS_ACTIVE_POS: readonly [number, number, number] = [0, 1.36, -0.92];

/** 2D tile grid dimensions inside the active foreground glass panel. */
export const GLASS_GRID_COLS = 4;
export const GLASS_GRID_VISIBLE_ROWS = 3;

/** Maximum ancestor or remembered-descendant ghost panels rendered above/below to save VRAM. */
export const GLASS_MAX_STACK_GHOSTS = 3;

/** Vertical / depth cascade offsets per stack depth step for pushed-out ancestor & child panels. */
export const GLASS_STACK_STEP_Z = -0.34;
export const GLASS_ANCESTOR_STEP_Y = 0.34;
export const GLASS_DESCENDANT_STEP_Y = -0.31;

/** Sibling rotunda arc constants flanking left & right of the foreground panel. */
export const ROTUNDA_ARC_RADIUS = 1.24;
export const ROTUNDA_ARC_CENTER_Z = -0.36;
export const ROTUNDA_ARC_Y = 1.34;
/** Angular half-gap (rad) left open in front so siblings flank the foreground panel cleanly. */
export const ROTUNDA_CENTER_GAP_RAD = 0.56;
/** Angular spacing (rad) between adjacent sibling slots along the rotunda arc. */
export const ROTUNDA_SLOT_STEP_RAD = 0.32;
/** Max sibling slots visible on each side (left & right) simultaneously. */
export const ROTUNDA_MAX_SLOTS_PER_SIDE = 4;
/** Smaller glass card size (m) for package/folder/library siblings in the rotunda. */
export const ROTUNDA_PACKAGE_CARD_W = 0.34;
export const ROTUNDA_PACKAGE_CARD_H = 0.34;

/** Thumbstick continuous scroll / pan speeds and inertial damping. */
export const GLASS_SCROLL_SPEED_ROWS_PER_SEC = 4.2;
export const GLASS_SCROLL_INERTIA_DAMPING = 9.5;
export const ROTUNDA_PAN_SPEED_SLOTS_PER_SEC = 4.6;
export const ROTUNDA_PAN_INERTIA_DAMPING = 8.4;

/** Schmitt hysteresis thresholds for discrete Up/Down hierarchy flicks. */
export const HIERARCHY_FLICK_ENGAGE = 0.62;
export const HIERARCHY_FLICK_RESET = 0.26;
export const HIERARCHY_FLICK_COOLDOWN_MS = 280;

/** Magnetic tile lock grace & dwell timings (seconds) for jitter-free VR trigger/grab selection. */
export const GLASS_TILE_MAGNET_HOLD_SEC = 0.18;
export const GLASS_TILE_MAGNET_SWITCH_DWELL_SEC = 0.06;

/** Half-width in sibling-slot units for Option A smooth behind-panel rotunda bridge. */
export const ROTUNDA_BRIDGE_HALF_SPAN = 0.55;
/** Maximum extra Z recess (m) as a rotunda sibling glides smoothly behind the foreground panel. */
export const ROTUNDA_BRIDGE_RECESS_Z = -0.36;

/** Maximum recently materialized leaf components pinned in the bottom quick-grab tray. */
export const GLASS_MAX_RECENT_ITEMS = 4;

/** Hover dwell (ms) before popping a live 3D hologram miniature proud of a leaf component tile. */
export const GLASS_HOLOGRAM_HOVER_DELAY_MS = 150;

/** Quick-tap threshold (ms) & movement radius (m) for click-to-place vs hold-and-drag affordance. */
export const QUICK_TAP_MAX_MS = 175;
export const QUICK_TAP_MAX_MOVE_M = 0.035;

/** Fixed O(1) VRAM shared sprite atlas dimensions for visible flanking rotunda siblings (5×2 = 10 slots). */
export const ROTUNDA_ATLAS_COLS = 5;
export const ROTUNDA_ATLAS_ROWS = 2;
export const ROTUNDA_ATLAS_MAX_SLOTS = ROTUNDA_ATLAS_COLS * ROTUNDA_ATLAS_ROWS;
export const ROTUNDA_ATLAS_TILE_PX = 320;
export const ROTUNDA_ATLAS_W = ROTUNDA_ATLAS_COLS * ROTUNDA_ATLAS_TILE_PX; // 1600
export const ROTUNDA_ATLAS_H = ROTUNDA_ATLAS_ROWS * ROTUNDA_ATLAS_TILE_PX; // 640

/** LocalStorage key persisting starred/favorite library & package IDs. */
export const GLASS_STARRED_STORAGE_KEY = "modelscript:vr:starred-libraries:v1";

/** Compact VR glass keyboard rows for in-headset quick search. */
export const VR_KEYBOARD_ROWS: readonly (readonly string[])[] = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", "⌫"],
  ["Z", "X", "C", "V", "B", "N", "M", ".", "CLR", "🎙"],
];

/* -------------------------------------------------------------------------- */
/*  Decoupled Live Library Provider Interface (Ansatz Editor / LSP Bridge)    */
/* -------------------------------------------------------------------------- */

export interface RotundaLibraryTreeNode {
  readonly id: string;
  readonly name: string;
  readonly compositeName?: string | undefined;
  readonly localizedName?: string | undefined;
  readonly classKind?: string | undefined;
  readonly hasChildren: boolean;
  readonly iconSvg?: string | null | undefined;
  readonly language?: string | undefined;
  readonly description?: string | null | undefined;
}

export interface RotundaLibraryParameterInfo {
  readonly name: string;
  readonly value?: string | undefined;
  readonly unit?: string | undefined;
}

export interface RotundaLibraryProvider {
  /** Loads root libraries (`parentId === undefined`) or children of a package/folder (`parentId`). */
  readonly loadChildren: (parentId?: string) => Promise<readonly RotundaLibraryTreeNode[]>;
  /** Optional lazy SVG icon loader for a class/package FQN. */
  readonly loadIcon?: ((className: string) => Promise<string | null>) | undefined;
  /** Optional live LSP class search powering the VR Quick-Search & Voice pill. */
  readonly searchClasses?: ((query: string, limit?: number) => Promise<readonly RotundaLibraryTreeNode[]>) | undefined;
  /** Optional lazy parameter defaults loader powering the hover Spec Peek chip. */
  readonly loadParameters?: ((className: string) => Promise<readonly RotundaLibraryParameterInfo[]>) | undefined;
}

/* -------------------------------------------------------------------------- */
/*  Hierarchical Library Node & Navigation Stack Types                        */
/* -------------------------------------------------------------------------- */

export type GlassLibraryNodeKind = "library" | "package" | "folder" | "component";

export interface GlassLibraryNode {
  readonly id: string;
  readonly name: string;
  readonly fqn: string;
  readonly kind: GlassLibraryNodeKind;
  readonly classKind?: string | undefined;
  readonly languageId?: string | undefined;
  readonly hasChildren: boolean;
  readonly accentColor: string;
  readonly subtitle?: string | undefined;
  readonly iconSvg?: string | null | undefined;
  readonly realisticKind?: RealisticComponentKind | null | undefined;
  /** Backing catalog item when this node is a materializable leaf component. */
  readonly galleryItem?: GalleryComponentItem | undefined;
  /** Optional statically known children (for fallback catalog / unit tests). */
  readonly children?: readonly GlassLibraryNode[] | undefined;
}

export interface GlassLibraryLevel {
  /** Stable identifier of the parent node whose children are displayed (`"__root__"` at top level). */
  readonly parentId: string;
  /** Human-readable title displayed in the glass header & pushed-out skeleton pill. */
  readonly title: string;
  /** Language identifier for theme accenting. */
  readonly languageId: string;
  /** Accent hex color for glass trim & header badge. */
  readonly accentColor: string;
  /** The node in the parent level that was opened to enter this level (`null` at root). */
  readonly sourceNode: GlassLibraryNode | null;
  /** Ordered list of tiles displayed in this level's 2D grid. */
  readonly items: readonly GlassLibraryNode[];
  /** Current smooth vertical scroll offset in rows (`0 .. maxScrollRow`). */
  readonly scrollRow: number;
  /** True while children are still being fetched asynchronously from LSP. */
  readonly loading?: boolean | undefined;
}

export interface GlassLibraryNavState {
  /**
   * Full navigation path from root (`0`) down to the deepest remembered child/grandchild.
   * - Indices `< activeDepth` are ancestors (pushed back & higher).
   * - Index `=== activeDepth` is the active foreground 2D-grid glass panel.
   * - Indices `> activeDepth` are the remembered descendant path (pushed back & lower).
   */
  readonly levels: readonly GlassLibraryLevel[];
  /** Index into `levels` of the currently active foreground glass panel. */
  readonly activeDepth: number;
  /** Continuous rotunda pan index among the siblings of `levels[activeDepth]` (parent's items). */
  readonly rotundaPanIndex: number;
  /** Smooth pan velocity (slots/sec) for inertial rotunda coasting. */
  readonly rotundaPanVel: number;
  /** Smooth vertical scroll velocity (rows/sec) for active panel grid coasting. */
  readonly scrollVel: number;
}

export interface GlassStackPanelPose {
  readonly levelIndex: number;
  readonly role: "ancestor" | "active" | "descendant";
  /** Relative depth offset: negative = ancestor above, 0 = active, positive = remembered child below. */
  readonly relativeDepth: number;
  readonly position: readonly [number, number, number];
  readonly pitchRad: number;
  readonly scale: number;
  readonly opacity: number;
  /** True for pushed-out ancestor/descendant panels (renders lightweight skeleton instead of icons). */
  readonly useSkeleton: boolean;
}

export interface SiblingRotundaSlot {
  readonly siblingIndex: number;
  readonly node: GlassLibraryNode;
  readonly side: "left" | "right";
  /** Signed distance in slots from the active sibling (`< 0` = left wing, `> 0` = right wing). */
  readonly signedOffset: number;
  readonly position: readonly [number, number, number];
  readonly yawRad: number;
  readonly scale: number;
  readonly opacity: number;
  readonly isContainer: boolean;
}

export interface GlassPanelHitZone {
  readonly kind:
    | "tile"
    | "star"
    | "reveal-tree"
    | "close"
    | "pin"
    | "search"
    | "up"
    | "down"
    | "breadcrumb"
    | "scroll-up"
    | "scroll-down"
    | "lang-filter"
    | "recent";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly index?: number | undefined;
  readonly languageId?: string | undefined;
  readonly node?: GlassLibraryNode | undefined;
  readonly recentItem?: GalleryComponentItem | undefined;
}

export interface GlassTileMagnetState {
  readonly lockedTileIndex: number | null;
  readonly holdRemainingSec: number;
  readonly pendingTileIndex: number | null;
  readonly pendingDwellSec: number;
}

export const INITIAL_GLASS_TILE_MAGNET_STATE: GlassTileMagnetState = {
  lockedTileIndex: null,
  holdRemainingSec: 0,
  pendingTileIndex: null,
  pendingDwellSec: 0,
};

export interface HeadRelativeAnchor {
  readonly position: readonly [number, number, number];
  readonly yawRad: number;
}

export type ActivePanelTransitionKind = "none" | "drill" | "step-up" | "step-down" | "sibling";

export interface ActivePanelTransitionOffset {
  readonly dy: number;
  readonly dz: number;
  readonly scale: number;
  readonly opacity: number;
  readonly settled: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Node Classification & Conversion Helpers                                  */
/* -------------------------------------------------------------------------- */

const CONTAINER_CLASS_KINDS = new Set([
  "package",
  "library",
  "folder",
  "directory",
  "loading-package",
  "owl2-folder",
  "ontology-folder",
  "ontology-package",
  "namespace",
  "module",
]);

export function isContainerLibraryNode(node: Pick<GlassLibraryNode, "kind" | "hasChildren">): boolean {
  return node.hasChildren || node.kind === "library" || node.kind === "package" || node.kind === "folder";
}

export function inferLanguageFromNodeName(name: string, explicitLang?: string | null): string {
  const norm = (explicitLang ?? "").trim().toLowerCase();
  if (norm) return norm;
  const lower = name.toLowerCase();
  if (lower.includes("sysml") || lower.endsWith(".sysml")) return "sysml2";
  if (lower.includes("spice") || lower.endsWith(".cir") || lower.endsWith(".sp")) return "spice";
  if (lower.includes("pscad") || lower.endsWith(".pscx")) return "pscad";
  if (lower.includes("psse") || lower.includes("pss/e") || lower.endsWith(".raw")) return "psse";
  if (lower.includes("simulink") || lower.endsWith(".slx")) return "simulink";
  if (lower.includes("urdf") || lower.endsWith(".urdf")) return "urdf";
  if (lower.includes("scad") || lower.endsWith(".scad")) return "scad";
  if (lower.includes("cantera")) return "cantera";
  if (lower.includes("sbml")) return "sbml";
  if (lower.includes("ampl") || lower.endsWith(".mod")) return "ampl";
  return "modelica";
}

function inferDomainCategory(fqn: string, name: string): Exclude<EngineeringDomainId, "all"> {
  const text = `${fqn} ${name}`.toLowerCase();
  if (/power|grid|bus|line|transformer|openipsl|pscad|psse|generator|turbine/.test(text)) return "power-grids";
  if (/fluid|thermal|heat|pipe|pump|valve|tank|steam|hvac|building/.test(text)) return "fluids-thermal";
  if (/mech|rotational|translational|multibody|spring|damper|mass|inertia|gear|joint/.test(text)) return "mechanics";
  if (/block|control|pid|gain|integrator|step|ramp|sine|source|math|signal/.test(text)) return "control";
  if (/robot|urdf|cad|scad|step|link|servo|actuator/.test(text)) return "robotics-cad";
  if (/sysml|req|state|arch|system|owl|ontology/.test(text)) return "systems";
  return "electrical";
}

/** Converts an LSP `RotundaLibraryTreeNode` into a `GlassLibraryNode`, including a materializable `GalleryComponentItem` for leaves. */
export function treeNodeToGlassLibraryNode(
  raw: RotundaLibraryTreeNode,
  depth: number,
  fallbackLanguageId = "modelica",
): GlassLibraryNode {
  const cleanFqn = (raw.compositeName ?? raw.name ?? "")
    .replace(/^__LIB__:[^/]+\//, "")
    .replace(/^__LIB__:/, "")
    .trim();
  const displayName = (raw.localizedName ?? raw.name ?? cleanFqn).replace(/^__LIB__:/, "").trim() || "Untitled";
  const classKind = (raw.classKind ?? "").toLowerCase();
  const langId = inferLanguageFromNodeName(cleanFqn || displayName, raw.language ?? fallbackLanguageId);
  const theme = resolveDiagramLanguageTheme(langId);

  const isContainer = Boolean(raw.hasChildren) || CONTAINER_CLASS_KINDS.has(classKind);
  const kind: GlassLibraryNodeKind = isContainer
    ? depth === 0
      ? "library"
      : classKind.includes("folder")
        ? "folder"
        : "package"
    : "component";

  const realisticKind = !isContainer ? resolveRealisticComponentKind(`${raw.id} ${cleanFqn} ${displayName}`) : null;

  const galleryItem: GalleryComponentItem | undefined = !isContainer
    ? {
        id: raw.id,
        shortName: displayName,
        fqn: cleanFqn || displayName,
        kind: raw.classKind || "model",
        category: inferDomainCategory(cleanFqn, displayName),
        packageName: cleanFqn.split(".")[0] || theme.badgeLabel,
        packageVersion: "workspace",
        summary: raw.description || `${displayName} (${cleanFqn || langId})`,
        portsAndParams: raw.classKind ? `${raw.classKind} · ${theme.badgeLabel}` : theme.badgeLabel,
        declarationSnippet: `${cleanFqn || displayName} ${displayName.replace(/[^A-Za-z0-9_]/g, "_").toLowerCase()};`,
        keywords: [displayName, cleanFqn, langId].filter(Boolean),
        schematicSvg:
          raw.iconSvg ||
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 56"><rect x="14" y="10" width="52" height="36" rx="6" fill="none" stroke="${theme.accentColor}" stroke-width="2.6"/><circle cx="14" cy="28" r="3.5" fill="${theme.accentColor}"/><circle cx="66" cy="28" r="3.5" fill="${theme.accentColor}"/></svg>`,
      }
    : undefined;

  return {
    id: raw.id,
    name: displayName,
    fqn: cleanFqn || displayName,
    kind,
    classKind: raw.classKind,
    languageId: langId,
    hasChildren: isContainer,
    accentColor: theme.accentColor,
    subtitle: isContainer
      ? depth === 0
        ? theme.badgeLabel
        : raw.classKind || "Package"
      : raw.classKind || "Component",
    iconSvg: raw.iconSvg ?? null,
    realisticKind,
    galleryItem,
  };
}

/**
 * Builds a clean multi-level fallback hierarchy (`Library → Package/Domain → Component`)
 * from a flat `GalleryComponentItem[]` catalog when running standalone (without an active LSP worker).
 */
export function buildFallbackLibraryTree(
  catalog: readonly GalleryComponentItem[] = GALLERY_COMPONENTS,
  defaultLanguageId = "modelica",
): readonly GlassLibraryNode[] {
  const source = catalog.length > 0 ? catalog : GALLERY_COMPONENTS;
  const byLib = new Map<string, GalleryComponentItem[]>();

  for (const item of source) {
    const libName = (item.packageName || item.fqn.split(".")[0] || "Modelica").trim();
    const list = byLib.get(libName);
    if (list) {
      list.push(item);
    } else {
      byLib.set(libName, [item]);
    }
  }

  const domainMetaMap = new Map(DOMAIN_FILTERS.map((d) => [d.id, d]));
  const libraries: GlassLibraryNode[] = [];

  for (const [libName, libItems] of byLib.entries()) {
    const langId = inferLanguageFromNodeName(libName, defaultLanguageId);
    const theme = resolveDiagramLanguageTheme(langId);

    const bySubPkg = new Map<string, GalleryComponentItem[]>();
    for (const item of libItems) {
      const fqnParts = item.fqn.split(".").filter(Boolean);
      const subName =
        fqnParts.length >= 3
          ? fqnParts[1]!
          : (domainMetaMap.get(item.category)?.label ?? item.category ?? "Components");
      const group = bySubPkg.get(subName);
      if (group) {
        group.push(item);
      } else {
        bySubPkg.set(subName, [item]);
      }
    }

    const libChildren: GlassLibraryNode[] = [];
    if (bySubPkg.size === 1) {
      for (const item of libItems) {
        libChildren.push(galleryItemToLeafNode(item, langId, theme.accentColor));
      }
    } else {
      for (const [subName, subItems] of bySubPkg.entries()) {
        const subFqn = `${libName}.${subName}`;
        const leafNodes = subItems.map((it) => galleryItemToLeafNode(it, langId, theme.accentColor));
        libChildren.push({
          id: `pkg:${subFqn}`,
          name: subName,
          fqn: subFqn,
          kind: "package",
          classKind: "package",
          languageId: langId,
          hasChildren: true,
          accentColor: theme.accentColor,
          subtitle: `${leafNodes.length} items`,
          children: leafNodes,
        });
      }
    }

    libraries.push({
      id: `lib:${libName}`,
      name: libName,
      fqn: libName,
      kind: "library",
      classKind: "package",
      languageId: langId,
      hasChildren: true,
      accentColor: theme.accentColor,
      subtitle: `${theme.badgeLabel} · ${libItems.length}`,
      children: libChildren,
    });
  }

  return libraries;
}

function galleryItemToLeafNode(item: GalleryComponentItem, languageId: string, accentColor: string): GlassLibraryNode {
  return {
    id: `comp:${item.id}`,
    name: item.shortName,
    fqn: item.fqn,
    kind: "component",
    classKind: item.kind,
    languageId,
    hasChildren: false,
    accentColor,
    subtitle: item.portsAndParams,
    iconSvg: item.schematicSvg,
    realisticKind: resolveRealisticComponentKind(`${item.id} ${item.fqn} ${item.shortName}`),
    galleryItem: item,
  };
}

/* -------------------------------------------------------------------------- */
/*  Depth-Stack & Remembered-Path State Machine                               */
/* -------------------------------------------------------------------------- */

export function computeMaxScrollRow(itemCount: number): number {
  const totalRows = Math.ceil(Math.max(0, itemCount) / GLASS_GRID_COLS);
  return Math.max(0, totalRows - GLASS_GRID_VISIBLE_ROWS);
}

export function createInitialGlassLibraryState(
  rootLibraries: readonly GlassLibraryNode[],
  defaultLanguageId = "modelica",
): GlassLibraryNavState {
  const theme = resolveDiagramLanguageTheme(defaultLanguageId);
  return {
    levels: [
      {
        parentId: "__root__",
        title: "Loaded Libraries",
        languageId: defaultLanguageId,
        accentColor: theme.accentColor,
        sourceNode: null,
        items: rootLibraries,
        scrollRow: 0,
      },
    ],
    activeDepth: 0,
    rotundaPanIndex: 0,
    rotundaPanVel: 0,
    scrollVel: 0,
  };
}

/**
 * Drills into a container node (`library` / `package` / `folder`).
 * - Pushes the current active level up into the ancestor stack (`levels[0..activeDepth]`).
 * - If the user re-opens the exact same child already remembered at `activeDepth + 1`,
 *   the deeper remembered grandchildren (`activeDepth + 2..`) are preserved!
 * - Otherwise replaces the descendant branch with the newly opened level.
 */
export function drillIntoGlassNode(
  state: GlassLibraryNavState,
  node: GlassLibraryNode,
  children: readonly GlassLibraryNode[],
  loading = false,
): GlassLibraryNavState {
  const curLevel = state.levels[state.activeDepth];
  if (!curLevel) return state;

  const siblingIdx = Math.max(
    0,
    curLevel.items.findIndex((it) => it.id === node.id),
  );

  const nextDepth = state.activeDepth + 1;
  const rememberedNext = state.levels[nextDepth];

  if (rememberedNext && rememberedNext.parentId === node.id) {
    const updatedLevels = state.levels.slice();
    updatedLevels[nextDepth] = {
      ...rememberedNext,
      items: children.length > 0 || !loading ? children : rememberedNext.items,
      loading,
    };
    return {
      levels: updatedLevels,
      activeDepth: nextDepth,
      rotundaPanIndex: siblingIdx,
      rotundaPanVel: 0,
      scrollVel: 0,
    };
  }

  const nextLevel: GlassLibraryLevel = {
    parentId: node.id,
    title: node.name,
    languageId: node.languageId ?? curLevel.languageId,
    accentColor: node.accentColor,
    sourceNode: node,
    items: children,
    scrollRow: 0,
    loading,
  };

  return {
    levels: [...state.levels.slice(0, nextDepth), nextLevel],
    activeDepth: nextDepth,
    rotundaPanIndex: siblingIdx,
    rotundaPanVel: 0,
    scrollVel: 0,
  };
}

/** Updates asynchronously fetched children for a level matching `parentId`. */
export function hydrateGlassLevelChildren(
  state: GlassLibraryNavState,
  parentId: string,
  children: readonly GlassLibraryNode[],
): GlassLibraryNavState {
  const idx = state.levels.findIndex((lv) => lv.parentId === parentId);
  if (idx < 0) return state;
  const target = state.levels[idx]!;
  const maxScroll = computeMaxScrollRow(children.length);
  const nextLevels = state.levels.slice();
  nextLevels[idx] = {
    ...target,
    items: children,
    scrollRow: Math.min(target.scrollRow, maxScroll),
    loading: false,
  };
  return { ...state, levels: nextLevels };
}

/**
 * Steps UP one level in the package/folder hierarchy (e.g. Joystick Up).
 * Remembers the current level (and any deeper grandchildren) below the newly active level!
 */
export function stepUpGlassHierarchy(state: GlassLibraryNavState): GlassLibraryNavState {
  if (state.activeDepth <= 0) return state;
  const nextDepth = state.activeDepth - 1;
  let nextRotundaIdx = 0;
  if (nextDepth > 0) {
    const grandParent = state.levels[nextDepth - 1];
    const parentLevel = state.levels[nextDepth];
    if (grandParent && parentLevel?.sourceNode) {
      const idx = grandParent.items.findIndex((it) => it.id === parentLevel.sourceNode?.id);
      if (idx >= 0) nextRotundaIdx = idx;
    }
  }
  return {
    ...state,
    activeDepth: nextDepth,
    rotundaPanIndex: nextRotundaIdx,
    rotundaPanVel: 0,
    scrollVel: 0,
  };
}

/**
 * Steps DOWN one level back into the remembered child/grandchild path (e.g. Joystick Down).
 */
export function stepDownGlassHierarchy(state: GlassLibraryNavState): GlassLibraryNavState {
  if (state.activeDepth >= state.levels.length - 1) return state;
  const nextDepth = state.activeDepth + 1;
  const curLevel = state.levels[state.activeDepth];
  const childLevel = state.levels[nextDepth];
  let nextRotundaIdx = 0;
  if (curLevel && childLevel?.sourceNode) {
    const idx = curLevel.items.findIndex((it) => it.id === childLevel.sourceNode?.id);
    if (idx >= 0) nextRotundaIdx = idx;
  }
  return {
    ...state,
    activeDepth: nextDepth,
    rotundaPanIndex: nextRotundaIdx,
    rotundaPanVel: 0,
    scrollVel: 0,
  };
}

/** Jumps directly to any level index in the ancestor or remembered-descendant stack. */
export function jumpToGlassDepth(state: GlassLibraryNavState, targetDepth: number): GlassLibraryNavState {
  const clamped = Math.max(0, Math.min(state.levels.length - 1, Math.floor(targetDepth)));
  if (clamped === state.activeDepth) return state;
  let nextRotundaIdx = 0;
  if (clamped > 0) {
    const parent = state.levels[clamped - 1];
    const target = state.levels[clamped];
    if (parent && target?.sourceNode) {
      const idx = parent.items.findIndex((it) => it.id === target.sourceNode?.id);
      if (idx >= 0) nextRotundaIdx = idx;
    }
  }
  return {
    ...state,
    activeDepth: clamped,
    rotundaPanIndex: nextRotundaIdx,
    rotundaPanVel: 0,
    scrollVel: 0,
  };
}

/**
 * Switches the active foreground panel directly to a sibling container chosen from the
 * flanking sibling rotunda (at `activeDepth > 0`).
 */
export function switchToSiblingContainer(
  state: GlassLibraryNavState,
  siblingNode: GlassLibraryNode,
  children: readonly GlassLibraryNode[],
  loading = false,
): GlassLibraryNavState {
  if (state.activeDepth <= 0) return drillIntoGlassNode(state, siblingNode, children, loading);
  const parentLevel = state.levels[state.activeDepth - 1];
  if (!parentLevel) return state;

  const siblingIdx = Math.max(
    0,
    parentLevel.items.findIndex((it) => it.id === siblingNode.id),
  );

  const replacement: GlassLibraryLevel = {
    parentId: siblingNode.id,
    title: siblingNode.name,
    languageId: siblingNode.languageId ?? parentLevel.languageId,
    accentColor: siblingNode.accentColor,
    sourceNode: siblingNode,
    items: children,
    scrollRow: 0,
    loading,
  };

  return {
    levels: [...state.levels.slice(0, state.activeDepth), replacement],
    activeDepth: state.activeDepth,
    rotundaPanIndex: siblingIdx,
    rotundaPanVel: 0,
    scrollVel: 0,
  };
}

/* -------------------------------------------------------------------------- */
/*  Smooth Scroll & Rotunda Pan Kinematics                                    */
/* -------------------------------------------------------------------------- */

/** Advances active panel vertical grid scroll with clamping and bay-crossing detent detection. */
export function stepGlassGridScroll(
  scrollRow: number,
  scrollVel: number,
  stickY: number,
  impulseRow: number,
  maxScrollRow: number,
  deltaSec: number,
): { readonly scrollRow: number; readonly scrollVel: number; readonly crossedRow: boolean } {
  const dt = Math.min(Math.max(deltaSec, 0), 0.1);
  if (maxScrollRow <= 0) {
    return { scrollRow: 0, scrollVel: 0, crossedRow: false };
  }
  const sy = Number.isFinite(stickY) ? Math.max(-1, Math.min(1, stickY)) : 0;
  let vel = scrollVel + (Number.isFinite(impulseRow) ? impulseRow : 0);

  if (Math.abs(sy) > 0.001) {
    const targetVel = sy * GLASS_SCROLL_SPEED_ROWS_PER_SEC;
    const blend = 1 - Math.exp(-dt * 16);
    vel += (targetVel - vel) * blend;
  } else {
    vel *= Math.exp(-dt * GLASS_SCROLL_INERTIA_DAMPING);
    if (Math.abs(vel) < 0.015) vel = 0;
  }

  vel = Math.max(-12, Math.min(12, vel));
  const rawNext = scrollRow + vel * dt;
  const clamped = Math.max(0, Math.min(maxScrollRow, rawNext));
  if (clamped !== rawNext) {
    vel = 0;
  }

  const crossedRow = Math.floor(clamped + 0.5) !== Math.floor(scrollRow + 0.5);
  return { scrollRow: clamped, scrollVel: vel, crossedRow };
}

/** Advances horizontal sibling rotunda panning (joystick Left/Right) with detent ticks. */
export function stepSiblingRotundaPan(
  panIndex: number,
  panVel: number,
  stickX: number,
  impulseSlots: number,
  siblingCount: number,
  deltaSec: number,
): { readonly panIndex: number; readonly panVel: number; readonly crossedSlot: boolean } {
  const dt = Math.min(Math.max(deltaSec, 0), 0.1);
  if (siblingCount <= 1) {
    return { panIndex: 0, panVel: 0, crossedSlot: false };
  }
  const sx = Number.isFinite(stickX) ? Math.max(-1, Math.min(1, stickX)) : 0;
  let vel = panVel + (Number.isFinite(impulseSlots) ? impulseSlots : 0);

  if (Math.abs(sx) > 0.001) {
    const targetVel = sx * ROTUNDA_PAN_SPEED_SLOTS_PER_SEC;
    const blend = 1 - Math.exp(-dt * 15);
    vel += (targetVel - vel) * blend;
  } else {
    vel *= Math.exp(-dt * ROTUNDA_PAN_INERTIA_DAMPING);
    if (Math.abs(vel) < 0.02) vel = 0;
  }

  vel = Math.max(-14, Math.min(14, vel));
  const maxIdx = siblingCount - 1;
  const rawNext = panIndex + vel * dt;
  const clamped = Math.max(0, Math.min(maxIdx, rawNext));
  if (clamped !== rawNext) vel = 0;

  const crossedSlot = Math.round(clamped) !== Math.round(panIndex);
  return { panIndex: clamped, panVel: vel, crossedSlot };
}

/* -------------------------------------------------------------------------- */
/*  3D Spatial Poses: Depth Stack (Ancestors / Active / Descendants)          */
/* -------------------------------------------------------------------------- */

/**
 * Computes the 3D pose of every visible panel in the depth stack:
 * - Active level (`relativeDepth === 0`): centered in front of the user, full icon rendering.
 * - Ancestor levels (`relativeDepth < 0`): pushed further back (`-Z`) and higher (`+Y`),
 *   slightly tilted downward, rendered with lightweight skeleton tiles (no icon textures).
 * - Remembered descendant levels (`relativeDepth > 0`): pushed further back (`-Z`) and lower (`-Y`),
 *   slightly tilted upward, rendered with lightweight skeleton tiles.
 */
export function computeGlassStackPoses(levelCount: number, activeDepth: number): readonly GlassStackPanelPose[] {
  const poses: GlassStackPanelPose[] = [];
  const [baseX, baseY, baseZ] = GLASS_ACTIVE_POS;

  for (let i = 0; i < levelCount; i++) {
    const rel = i - activeDepth;
    if (Math.abs(rel) > GLASS_MAX_STACK_GHOSTS) continue;

    if (rel === 0) {
      poses.push({
        levelIndex: i,
        role: "active",
        relativeDepth: 0,
        position: [baseX, baseY, baseZ],
        pitchRad: 0,
        scale: 1,
        opacity: 1,
        useSkeleton: false,
      });
    } else if (rel < 0) {
      const steps = Math.abs(rel);
      const y = baseY + steps * GLASS_ANCESTOR_STEP_Y;
      const z = baseZ + steps * GLASS_STACK_STEP_Z;
      const scale = Math.max(0.68, 1 - steps * 0.11);
      const opacity = Math.max(0.28, 0.78 - (steps - 1) * 0.22);
      poses.push({
        levelIndex: i,
        role: "ancestor",
        relativeDepth: rel,
        position: [baseX, y, z],
        pitchRad: 0.14 * Math.min(steps, 2),
        scale,
        opacity,
        useSkeleton: true,
      });
    } else {
      const steps = rel;
      const y = baseY + steps * GLASS_DESCENDANT_STEP_Y;
      const z = baseZ + steps * GLASS_STACK_STEP_Z;
      const scale = Math.max(0.68, 1 - steps * 0.11);
      const opacity = Math.max(0.28, 0.78 - (steps - 1) * 0.22);
      poses.push({
        levelIndex: i,
        role: "descendant",
        relativeDepth: rel,
        position: [baseX, y, z],
        pitchRad: -0.16 * Math.min(steps, 2),
        scale,
        opacity,
        useSkeleton: true,
      });
    }
  }

  return poses;
}

/* -------------------------------------------------------------------------- */
/*  3D Spatial Poses: Flanking Sibling Rotunda Arc                            */
/* -------------------------------------------------------------------------- */

/**
 * Computes the curved rotunda arc poses for the sibling tiles of the currently open level.
 * Uses **Option A (Smooth Behind-Panel Bridge)**:
 * - Outside `|delta| >= ROTUNDA_BRIDGE_HALF_SPAN`, siblings flank cleanly to the left and right
 *   outside `±ROTUNDA_CENTER_GAP_RAD`, facing inward toward the user.
 * - Inside `|delta| < ROTUNDA_BRIDGE_HALF_SPAN`, a sibling smoothly arcs across `0` while
 *   recessing behind the foreground glass panel (`ROTUNDA_BRIDGE_RECESS_Z`) and dipping opacity,
 *   completely eliminating left↔right teleport jumps during fast panning!
 */
export function computeSiblingRotundaSlots(
  parentItems: readonly GlassLibraryNode[],
  activeSourceNodeId: string | null,
  panIndex: number,
): readonly SiblingRotundaSlot[] {
  if (parentItems.length <= 1) return [];

  const slots: SiblingRotundaSlot[] = [];

  for (let i = 0; i < parentItems.length; i++) {
    const node = parentItems[i]!;
    if (activeSourceNodeId && node.id === activeSourceNodeId) continue;

    const delta = i - panIndex;
    const absDelta = Math.abs(delta);
    if (absDelta > ROTUNDA_MAX_SLOTS_PER_SIDE + 0.65) continue;

    const sign = delta < 0 ? -1 : 1;
    let angle: number;
    let bridgeRecessZ = 0;
    let bridgeOpacity = 1;
    let wingRank = 0;

    if (absDelta < ROTUNDA_BRIDGE_HALF_SPAN) {
      // Smooth C1 behind-panel bridge: glides seamlessly behind the foreground glass panel
      const u = delta / ROTUNDA_BRIDGE_HALF_SPAN; // in (-1, 1)
      const sinTerm = Math.sin(u * Math.PI * 0.5);
      const cosTerm = Math.cos(u * Math.PI * 0.5);
      angle = sinTerm * ROTUNDA_CENTER_GAP_RAD;
      bridgeRecessZ = ROTUNDA_BRIDGE_RECESS_Z * (cosTerm * cosTerm);
      bridgeOpacity = 0.22 + 0.78 * Math.abs(u);
      wingRank = 0;
    } else {
      wingRank = absDelta - ROTUNDA_BRIDGE_HALF_SPAN;
      angle = sign * (ROTUNDA_CENTER_GAP_RAD + wingRank * ROTUNDA_SLOT_STEP_RAD);
    }

    if (Math.abs(angle) > 2.28) continue;

    const x = Math.sin(angle) * ROTUNDA_ARC_RADIUS;
    const z = ROTUNDA_ARC_CENTER_Z - Math.cos(angle) * ROTUNDA_ARC_RADIUS + bridgeRecessZ;
    const y = ROTUNDA_ARC_Y + Math.min(0.08, wingRank * 0.018);
    const yawRad = -angle;

    const edgeFade = Math.max(0.01, Math.min(1, (ROTUNDA_MAX_SLOTS_PER_SIDE + 0.65 - absDelta) / 0.85));
    const scale = (0.98 - Math.min(0.24, wingRank * 0.055)) * (0.4 + 0.6 * edgeFade);
    const opacity = Math.max(0.14, (0.96 - wingRank * 0.12) * edgeFade * bridgeOpacity);

    slots.push({
      siblingIndex: i,
      node,
      side: angle < 0 ? "left" : "right",
      signedOffset: delta,
      position: [x, y, z],
      yawRad,
      scale,
      opacity,
      isContainer: isContainerLibraryNode(node),
    });
  }

  return slots;
}

/* -------------------------------------------------------------------------- */
/*  Magnetic Tile Lock, Root Language Filters, Recents & Head-Relative Anchor */
/* -------------------------------------------------------------------------- */

/**
 * Sticky magnetic tile lock for the 2D foreground glass grid:
 * prevents Quest controller trigger/squeeze tremor from slipping into the 18px tile gap.
 */
export function stepGlassTileMagnetLock(
  state: GlassTileMagnetState,
  rawTileIndex: number | null,
  dtSec: number,
): { readonly next: GlassTileMagnetState; readonly justLocked: boolean } {
  const dt = Math.max(0, Math.min(0.1, dtSec));
  let locked = state.lockedTileIndex;
  let hold = state.holdRemainingSec;
  let pending = state.pendingTileIndex;
  let dwell = state.pendingDwellSec;
  let justLocked = false;

  if (rawTileIndex !== null) {
    if (locked === null) {
      locked = rawTileIndex;
      hold = GLASS_TILE_MAGNET_HOLD_SEC;
      pending = null;
      dwell = 0;
      justLocked = true;
    } else if (rawTileIndex === locked) {
      hold = GLASS_TILE_MAGNET_HOLD_SEC;
      pending = null;
      dwell = 0;
    } else {
      if (pending === rawTileIndex) {
        dwell += dt;
      } else {
        pending = rawTileIndex;
        dwell = dt;
      }
      if (dwell >= GLASS_TILE_MAGNET_SWITCH_DWELL_SEC) {
        locked = rawTileIndex;
        hold = GLASS_TILE_MAGNET_HOLD_SEC;
        pending = null;
        dwell = 0;
        justLocked = true;
      }
    }
  } else if (locked !== null) {
    pending = null;
    dwell = 0;
    hold = Math.max(0, hold - dt);
    if (hold <= 0) {
      locked = null;
    }
  }

  return {
    next: {
      lockedTileIndex: locked,
      holdRemainingSec: hold,
      pendingTileIndex: pending,
      pendingDwellSec: dwell,
    },
    justLocked,
  };
}

/** Extracts unique languages present in the root library list, pinning `activeLanguageId` first. */
export function extractAvailableLanguages(
  rootLibraries: readonly GlassLibraryNode[],
  activeLanguageId = "modelica",
): readonly string[] {
  const seen = new Set<string>();
  const normActive = (activeLanguageId || "modelica").trim().toLowerCase();
  for (const lib of rootLibraries) {
    const l = (lib.languageId || normActive).trim().toLowerCase();
    if (l) seen.add(l);
  }
  const list = Array.from(seen);
  list.sort((a, b) => {
    if (a === normActive) return -1;
    if (b === normActive) return 1;
    return a.localeCompare(b);
  });
  return list;
}

/** Filters root libraries by language (`"all"` returns all libraries unchanged). */
export function filterRootLibrariesByLanguage(
  rootLibraries: readonly GlassLibraryNode[],
  languageFilter: string,
): readonly GlassLibraryNode[] {
  const norm = (languageFilter || "all").trim().toLowerCase();
  if (norm === "all") return rootLibraries;
  return rootLibraries.filter((lib) => (lib.languageId || "modelica").trim().toLowerCase() === norm);
}

/** Prepends a materialized component to the deduplicated recent items tray (max `GLASS_MAX_RECENT_ITEMS`). */
export function recordRecentComponent(
  recents: readonly GalleryComponentItem[],
  item: GalleryComponentItem,
): readonly GalleryComponentItem[] {
  const filtered = recents.filter((r) => r.id !== item.id && r.fqn !== item.fqn);
  return [item, ...filtered].slice(0, GLASS_MAX_RECENT_ITEMS);
}

/**
 * Computes a comfortable head-relative spawn anchor (stage-local XZ + horizontal yaw)
 * so opening the Glass Library Navigator places the entire stack directly in front of the
 * engineer's current standing/teleported pose.
 */
export function computeHeadRelativeAnchor(
  headPosLocal: readonly [number, number, number],
  headForwardLocal: readonly [number, number, number],
  defaultEyeHeightY = GLASS_ACTIVE_POS[1],
): HeadRelativeAnchor {
  const fx = Number.isFinite(headForwardLocal[0]) ? headForwardLocal[0] : 0;
  const fz = Number.isFinite(headForwardLocal[2]) ? headForwardLocal[2] : -1;
  const horizLen = Math.hypot(fx, fz);
  const nx = horizLen > 1e-4 ? fx / horizLen : 0;
  const nz = horizLen > 1e-4 ? fz / horizLen : -1;
  // Yaw so local -Z faces along (nx, nz)
  const yawRad = Math.atan2(-nx, -nz);
  // Clamp anchor height to ergonomic standing eye/chest window
  const rawY = Number.isFinite(headPosLocal[1]) ? headPosLocal[1] - 0.14 : defaultEyeHeightY;
  const anchorY = Math.max(0.95, Math.min(1.75, rawY));
  return {
    position: [
      Number.isFinite(headPosLocal[0]) ? headPosLocal[0] : 0,
      anchorY - GLASS_ACTIVE_POS[1],
      Number.isFinite(headPosLocal[2]) ? headPosLocal[2] : 0,
    ],
    yawRad,
  };
}

/**
 * Evaluates smooth cubic-out emergence offset for the active foreground glass panel
 * whenever drilling down, stepping up, returning to a remembered child, or swapping siblings.
 */
export function computeActivePanelTransitionOffset(
  kind: ActivePanelTransitionKind,
  elapsedSec: number,
  durationSec = 0.24,
): ActivePanelTransitionOffset {
  if (kind === "none" || elapsedSec >= durationSec) {
    return { dy: 0, dz: 0, scale: 1, opacity: 1, settled: true };
  }
  const t = Math.max(0, Math.min(1, elapsedSec / Math.max(0.05, durationSec)));
  const inv = 1 - t;
  const ease = 1 - inv * inv * inv; // crisp cubic ease-out
  const rem = 1 - ease;

  if (kind === "drill") {
    return { dy: -0.05 * rem, dz: -0.22 * rem, scale: 0.86 + 0.14 * ease, opacity: 0.35 + 0.65 * ease, settled: false };
  }
  if (kind === "step-up") {
    return { dy: 0.14 * rem, dz: -0.18 * rem, scale: 0.9 + 0.1 * ease, opacity: 0.4 + 0.6 * ease, settled: false };
  }
  if (kind === "step-down") {
    return { dy: -0.14 * rem, dz: -0.18 * rem, scale: 0.9 + 0.1 * ease, opacity: 0.4 + 0.6 * ease, settled: false };
  }
  // sibling swap
  return { dy: 0, dz: -0.12 * rem, scale: 0.92 + 0.08 * ease, opacity: 0.45 + 0.55 * ease, settled: false };
}

/** Maps a foreground grid tile index `(tileIndex)` to its local 3D center `[x, y, z]` on the curved glass panel. */
export function computeTileLocalCenter3D(
  layout: GlassPanelLayout,
  tileIndex: number,
  scrollRow: number,
): readonly [number, number, number] | null {
  const row = Math.floor(tileIndex / GLASS_GRID_COLS);
  const col = tileIndex % GLASS_GRID_COLS;
  const ty = layout.gridY + (row - scrollRow) * (layout.tileH + layout.gapY);
  const cy = ty + layout.tileH * 0.42;
  if (cy < layout.gridY || cy > layout.gridY + layout.gridH) return null;
  const cx = layout.gridX + col * (layout.tileW + layout.gapX) + layout.tileW * 0.5;
  const u = cx / GLASS_CANVAS_W;
  const v = 1 - cy / GLASS_CANVAS_H;
  const localX = (u - 0.5) * GLASS_PANEL_W;
  const localY = (v - 0.5) * GLASS_PANEL_H;
  const t = localX / (GLASS_PANEL_W * 0.5);
  const curveZ = GLASS_PANEL_CURVE_DEPTH * (t * t);
  return [localX, localY, curveZ];
}

/* -------------------------------------------------------------------------- */
/*  2D Canvas Layout & Hit-Testing for the Active Foreground Glass Panel      */
/* -------------------------------------------------------------------------- */

export interface GlassPanelLayout {
  readonly headerY: number;
  readonly headerH: number;
  readonly gridX: number;
  readonly gridY: number;
  readonly gridW: number;
  readonly gridH: number;
  readonly tileW: number;
  readonly tileH: number;
  readonly gapX: number;
  readonly gapY: number;
  readonly zones: readonly GlassPanelHitZone[];
}

export function buildGlassPanelLayout(
  items: readonly GlassLibraryNode[],
  scrollRow: number,
  canStepUp: boolean,
  canStepDown: boolean,
  breadcrumbCount: number,
  options?: {
    readonly languageFilters?: readonly string[] | undefined;
    readonly recentItems?: readonly GalleryComponentItem[] | undefined;
    readonly searchMode?: boolean | undefined;
  },
): GlassPanelLayout {
  const padX = 34;
  const headerY = 20;
  const hasLangStrip = (options?.languageFilters?.length ?? 0) > 1 && !canStepUp;
  const hasRecentStrip = (options?.recentItems?.length ?? 0) > 0;
  const headerH = hasLangStrip ? 104 : 92;
  const gridX = padX;
  const gridY = headerY + headerH + 16;
  const scrollbarW = 24;
  const bottomReserve = hasRecentStrip ? 104 : 54;
  const gridW = GLASS_CANVAS_W - padX * 2 - scrollbarW - 14;
  const gridH = GLASS_CANVAS_H - gridY - bottomReserve;
  const gapX = 18;
  const gapY = 16;
  const tileW = (gridW - gapX * (GLASS_GRID_COLS - 1)) / GLASS_GRID_COLS;
  const tileH = (gridH - gapY * (GLASS_GRID_VISIBLE_ROWS - 1)) / GLASS_GRID_VISIBLE_ROWS;

  const zones: GlassPanelHitZone[] = [];

  // Top-right action pills: Up, Down (remembered child), Search, Pin, Close
  const closeW = 60;
  const closeH = 52;
  const closeX = GLASS_CANVAS_W - padX - closeW;
  const btnY = headerY + 18;
  zones.push({ kind: "close", x: closeX, y: btnY, w: closeW, h: closeH });

  const pinW = 78;
  const pinX = closeX - pinW - 8;
  zones.push({ kind: "pin", x: pinX, y: btnY, w: pinW, h: closeH });

  const searchW = 92;
  const searchX = pinX - searchW - 8;
  zones.push({ kind: "search", x: searchX, y: btnY, w: searchW, h: closeH });

  let leftCursor = searchX;
  const stepW = 94;
  if (canStepDown) {
    leftCursor -= stepW + 8;
    zones.push({ kind: "down", x: leftCursor, y: btnY, w: stepW, h: closeH });
  }
  if (canStepUp) {
    leftCursor -= stepW + 8;
    zones.push({ kind: "up", x: leftCursor, y: btnY, w: stepW, h: closeH });
  }

  // Root-level Language Filter Strip OR Breadcrumb chips in header
  if (hasLangStrip && options?.languageFilters) {
    const langs = ["all", ...options.languageFilters.slice(0, 6)];
    let lx = padX + 12;
    const ly = headerY + 60;
    for (let i = 0; i < langs.length; i++) {
      const lid = langs[i]!;
      const lw = lid === "all" ? 76 : 114;
      zones.push({
        kind: "lang-filter",
        index: i,
        languageId: lid,
        x: lx,
        y: ly,
        w: lw,
        h: 34,
      });
      lx += lw + 8;
    }
  } else {
    const crumbStartX = padX + 12;
    const crumbY = headerY + 54;
    const maxCrumbs = Math.min(breadcrumbCount, 4);
    for (let i = 0; i < maxCrumbs; i++) {
      zones.push({
        kind: "breadcrumb",
        index: i,
        x: crumbStartX + i * 180,
        y: crumbY,
        w: 170,
        h: 32,
      });
    }
  }

  // Scrollbar up/down quick buttons on right edge
  const sbX = gridX + gridW + 14;
  zones.push({ kind: "scroll-up", x: sbX - 4, y: gridY, w: scrollbarW + 8, h: 48 });
  zones.push({ kind: "scroll-down", x: sbX - 4, y: gridY + gridH - 48, w: scrollbarW + 8, h: 48 });

  // Visible 2D tile grid hit zones (accounting for continuous scrollRow)
  const rowPitch = tileH + gapY;
  const firstRow = Math.max(0, Math.floor(scrollRow));
  const lastRow = Math.ceil(scrollRow) + GLASS_GRID_VISIBLE_ROWS;
  for (let row = firstRow; row <= lastRow; row++) {
    const ty = gridY + (row - scrollRow) * rowPitch;
    if (ty + tileH < gridY + 4 || ty > gridY + gridH - 4) continue;
    for (let col = 0; col < GLASS_GRID_COLS; col++) {
      const idx = row * GLASS_GRID_COLS + col;
      const node = items[idx];
      if (!node) continue;
      const tx = gridX + col * (tileW + gapX);
      const clippedY = Math.max(gridY, ty);
      const clippedBot = Math.min(gridY + gridH, ty + tileH);
      if (clippedBot - clippedY < 20) continue;
      // Top-left star favorite hit zone (checked before tile so clicking ★ toggles favorite!)
      if (ty >= gridY - 2) {
        zones.push({
          kind: "star",
          index: idx,
          node,
          x: tx + 10,
          y: ty + 18,
          w: 34,
          h: 34,
        });
        // Top-right "↗ Tree" reveal-in-hierarchy pill when viewing Search results
        if (options?.searchMode && node.fqn.includes(".")) {
          zones.push({
            kind: "reveal-tree",
            index: idx,
            node,
            x: tx + tileW - 86,
            y: ty + 18,
            w: 74,
            h: 30,
          });
        }
      }
      zones.push({
        kind: "tile",
        index: idx,
        node,
        x: tx,
        y: clippedY,
        w: tileW,
        h: clippedBot - clippedY,
      });
    }
  }

  // Persistent "Recently Placed" quick-grab mini-tray along bottom edge
  if (hasRecentStrip && options?.recentItems) {
    const recents = options.recentItems.slice(0, GLASS_MAX_RECENT_ITEMS);
    const labelW = 128;
    const trayX = gridX + labelW;
    const trayY = gridY + gridH + 12;
    const trayH = 44;
    const slotGap = 12;
    const slotW = Math.min(240, (gridW - labelW - slotGap * (GLASS_MAX_RECENT_ITEMS - 1)) / GLASS_MAX_RECENT_ITEMS);
    for (let i = 0; i < recents.length; i++) {
      zones.push({
        kind: "recent",
        index: i,
        recentItem: recents[i]!,
        x: trayX + i * (slotW + slotGap),
        y: trayY,
        w: slotW,
        h: trayH,
      });
    }
  }

  return { headerY, headerH, gridX, gridY, gridW, gridH, tileW, tileH, gapX, gapY, zones };
}

/** Hit-tests canvas pixel coordinates `(px, py)` against the active glass panel layout. */
export function hitTestGlassPanel(layout: GlassPanelLayout, px: number, py: number): GlassPanelHitZone | null {
  for (const z of layout.zones) {
    if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) {
      return z;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  #1 O(1) VRAM Rotunda Atlas UV Rects                                       */
/* -------------------------------------------------------------------------- */

export interface RotundaAtlasUvRect {
  readonly u0: number;
  readonly u1: number;
  readonly vBot: number;
  readonly vTop: number;
  readonly px: number;
  readonly py: number;
  readonly size: number;
}

/** Computes UV & pixel rect for one of the 10 pooled O(1)-VRAM rotunda atlas slots. */
export function computeRotundaAtlasUvRect(poolIndex: number): RotundaAtlasUvRect {
  const safe = Math.max(0, Math.min(ROTUNDA_ATLAS_MAX_SLOTS - 1, Math.floor(poolIndex)));
  const col = safe % ROTUNDA_ATLAS_COLS;
  const row = Math.floor(safe / ROTUNDA_ATLAS_COLS);
  const px = col * ROTUNDA_ATLAS_TILE_PX;
  const py = row * ROTUNDA_ATLAS_TILE_PX;
  const pad = 2;
  return {
    u0: (px + pad) / ROTUNDA_ATLAS_W,
    u1: (px + ROTUNDA_ATLAS_TILE_PX - pad) / ROTUNDA_ATLAS_W,
    vTop: 1 - (py + pad) / ROTUNDA_ATLAS_H,
    vBot: 1 - (py + ROTUNDA_ATLAS_TILE_PX - pad) / ROTUNDA_ATLAS_H,
    px,
    py,
    size: ROTUNDA_ATLAS_TILE_PX,
  };
}

/* -------------------------------------------------------------------------- */
/*  #4 Pin-Open Multi-Drop Shoulder Dock Offset                               */
/* -------------------------------------------------------------------------- */

export function computePinnedPanelOffset(
  pinned: boolean,
  parkedToShoulder: boolean,
): { readonly dx: number; readonly dz: number; readonly yawRad: number } {
  if (!pinned || !parkedToShoulder) return { dx: 0, dz: 0, yawRad: 0 };
  return { dx: -0.56, dz: 0.14, yawRad: 0.34 };
}

/* -------------------------------------------------------------------------- */
/*  #5 Quick-Search Local Filter & Compact VR Glass Keyboard                  */
/* -------------------------------------------------------------------------- */

/** Recursively searches a local `GlassLibraryNode[]` tree by name, FQN, or subtitle. */
export function searchLocalLibraryTree(
  roots: readonly GlassLibraryNode[],
  query: string,
  limit = 24,
): readonly GlassLibraryNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: GlassLibraryNode[] = [];
  const visited = new Set<string>();

  const walk = (nodes: readonly GlassLibraryNode[]) => {
    for (const n of nodes) {
      if (results.length >= limit) return;
      if (visited.has(n.id)) continue;
      visited.add(n.id);
      const hay = `${n.name} ${n.fqn} ${n.subtitle ?? ""}`.toLowerCase();
      if (hay.includes(q)) {
        results.push(n);
      }
      if (n.children && n.children.length > 0) {
        walk(n.children);
      }
    }
  };
  walk(roots);
  return results;
}

export const VR_KEYBOARD_CANVAS_W = 920;
export const VR_KEYBOARD_CANVAS_H = 264;

export interface VrKeyboardKeyRect {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function buildVrKeyboardLayout(): readonly VrKeyboardKeyRect[] {
  const rects: VrKeyboardKeyRect[] = [];
  const padX = 18;
  const padY = 16;
  const gap = 8;
  const rows = VR_KEYBOARD_ROWS.length;
  const keyH = (VR_KEYBOARD_CANVAS_H - padY * 2 - gap * (rows - 1)) / rows;

  for (let r = 0; r < rows; r++) {
    const row = VR_KEYBOARD_ROWS[r]!;
    const keyW = (VR_KEYBOARD_CANVAS_W - padX * 2 - gap * (row.length - 1)) / row.length;
    const y = padY + r * (keyH + gap);
    for (let c = 0; c < row.length; c++) {
      rects.push({
        key: row[c]!,
        x: padX + c * (keyW + gap),
        y,
        w: keyW,
        h: keyH,
      });
    }
  }
  return rects;
}

export function hitTestVrKeyboard(
  rects: readonly VrKeyboardKeyRect[],
  px: number,
  py: number,
): VrKeyboardKeyRect | null {
  for (const r of rects) {
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  #6 Context-Aware Port Compatibility Scoring                               */
/* -------------------------------------------------------------------------- */

/** Returns true when a leaf component node matches at least one open/unconnected port domain on the 3D diagram. */
export function isNodeCompatibleWithOpenPorts(
  node: GlassLibraryNode,
  openPortDomains: readonly SpatialPortDomain[] | undefined,
): boolean {
  if (!openPortDomains || openPortDomains.length === 0 || isContainerLibraryNode(node)) return false;
  if (!node.galleryItem) return false;
  const nodeDomain = categoryToSpatialDomain(node.galleryItem.category);
  return openPortDomains.includes(nodeDomain);
}

/* -------------------------------------------------------------------------- */
/*  #7 Starred / Favorite Libraries & Packages Persistence                    */
/* -------------------------------------------------------------------------- */

export function loadStarredNodeIds(): ReadonlySet<string> {
  if (typeof window === "undefined" || !window.localStorage) return new Set();
  try {
    const raw = window.localStorage.getItem(GLASS_STARRED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((x): x is string => typeof x === "string"));
    }
  } catch {
    /* ignore storage errors */
  }
  return new Set();
}

export function toggleStarredNodeId(current: ReadonlySet<string>, nodeId: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(GLASS_STARRED_STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      /* ignore storage errors */
    }
  }
  return next;
}

export function sortNodesWithStarredFirst(
  nodes: readonly GlassLibraryNode[],
  starredIds: ReadonlySet<string>,
): readonly GlassLibraryNode[] {
  if (starredIds.size === 0) return nodes;
  const starred: GlassLibraryNode[] = [];
  const rest: GlassLibraryNode[] = [];
  for (const n of nodes) {
    if (starredIds.has(n.id) || starredIds.has(n.fqn)) {
      starred.push(n);
    } else {
      rest.push(n);
    }
  }
  return starred.length > 0 ? [...starred, ...rest] : nodes;
}

/* -------------------------------------------------------------------------- */
/*  #8 Live Port & Parameter Spec Peek Formatting                             */
/* -------------------------------------------------------------------------- */

export interface NodeSpecPeekInfo {
  readonly title: string;
  readonly portsLabel: string;
  readonly paramsLabel: string;
}

export function formatNodeSpecPeek(
  node: GlassLibraryNode,
  liveParams?: readonly RotundaLibraryParameterInfo[] | undefined,
): NodeSpecPeekInfo {
  const ports = node.galleryItem ? inferCatalogItemPorts(node.galleryItem) : [];
  const portNames = ports.map((p) => p.id).slice(0, 6);
  const portsLabel = portNames.length > 0 ? `Ports: ${portNames.join(", ")}` : "Component";
  let paramsLabel = (node.galleryItem?.portsAndParams || node.subtitle || node.fqn).slice(0, 38);
  if (liveParams && liveParams.length > 0) {
    const formatted = liveParams
      .slice(0, 3)
      .map((p) => `${p.name}=${p.value ?? "?"}${p.unit ? ` ${p.unit}` : ""}`)
      .join(" · ");
    if (formatted) paramsLabel = formatted.slice(0, 42);
  }
  return {
    title: node.name,
    portsLabel,
    paramsLabel,
  };
}

/**
 * Finds the ancestor chain of container nodes leading to `targetFqn` inside a local fallback tree.
 * Returns the ordered array of container nodes `[Library, Package, ...]` whose final container holds `targetFqn`.
 */
export function findAncestorPathInLocalTree(
  roots: readonly GlassLibraryNode[],
  targetFqn: string,
): readonly GlassLibraryNode[] | null {
  const norm = targetFqn.trim();
  if (!norm) return null;

  const walk = (
    nodes: readonly GlassLibraryNode[],
    ancestors: readonly GlassLibraryNode[],
  ): readonly GlassLibraryNode[] | null => {
    for (const n of nodes) {
      if (n.fqn === norm || n.id === norm) {
        return ancestors;
      }
      if (n.children && n.children.length > 0) {
        const found = walk(n.children, [...ancestors, n]);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(roots, []);
}

/**
 * Splits a dot-separated FQN (e.g. `"Modelica.Electrical.Analog.Basic.Resistor"`)
 * into ancestor prefix segments `["Modelica", "Modelica.Electrical", "Modelica.Electrical.Analog", "Modelica.Electrical.Analog.Basic"]`
 * for asynchronous LSP "Reveal in Hierarchy" drill-down.
 */
export function splitFqnAncestorPrefixes(fqn: string): readonly string[] {
  const parts = fqn
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [];
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    out.push(parts.slice(0, i + 1).join("."));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  #9 Grabbable Glass Bezel Reposition Bounds                                */
/* -------------------------------------------------------------------------- */

export interface BezelRepositionOffset {
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
}

export function clampBezelRepositionOffset(dx: number, dy: number, dz: number): BezelRepositionOffset {
  return {
    dx: Math.max(-1.2, Math.min(1.2, Number.isFinite(dx) ? dx : 0)),
    dy: Math.max(-0.55, Math.min(0.65, Number.isFinite(dy) ? dy : 0)),
    dz: Math.max(-0.85, Math.min(0.45, Number.isFinite(dz) ? dz : 0)),
  };
}

/* -------------------------------------------------------------------------- */
/*  #10 Bare-Hand Pinch-Drag Scroll, Air-Swipe Rotunda & Tether Pull          */
/* -------------------------------------------------------------------------- */

export interface BareHandSwipeEvaluation {
  readonly scrollDeltaRows: number;
  readonly rotundaPanImpulse: number;
}

/**
 * Converts a bare-hand pinched pointer motion delta `(dxMeters, dyMeters)` over `dtSec`
 * into smooth vertical grid scroll or horizontal rotunda air-swipe impulse.
 */
export function evaluateBareHandSwipe(dxMeters: number, dyMeters: number, dtSec: number): BareHandSwipeEvaluation {
  const dt = Math.max(0.008, Math.min(0.1, dtSec));
  const vx = dxMeters / dt;
  const vy = dyMeters / dt;
  const scrollDeltaRows = Math.abs(vy) > 0.04 ? dyMeters * 7.5 : 0;
  const rotundaPanImpulse = Math.abs(vx) > 0.35 && Math.abs(vx) > Math.abs(vy) * 1.4 ? -vx * 3.8 : 0;
  return { scrollDeltaRows, rotundaPanImpulse };
}

/** Returns `-1` (step up), `+1` (step down), or `0` when pinching & pulling the vertical depth tether. */
export function evaluateTetherPullStep(accumulatedDyMeters: number, thresholdMeters = 0.085): -1 | 0 | 1 {
  if (accumulatedDyMeters >= thresholdMeters) return -1; // pull up -> step UP to parent
  if (accumulatedDyMeters <= -thresholdMeters) return 1; // pull down -> step DOWN to remembered child
  return 0;
}

/* -------------------------------------------------------------------------- */
/*  #11 Head-Parallax Specular Glint Math                                     */
/* -------------------------------------------------------------------------- */

/**
 * Computes normalized `[-1, 1]` horizontal & vertical specular sheen shift from the
 * head-to-panel offset so the frosted glass glint glides naturally with stereo head motion.
 */
export function computeHeadParallaxGlintOffset(
  headLocalX: number,
  headLocalY: number,
  panelLocalX: number,
  panelLocalY: number,
): { readonly glintX: number; readonly glintY: number } {
  const dx = Number.isFinite(headLocalX - panelLocalX) ? headLocalX - panelLocalX : 0;
  const dy = Number.isFinite(headLocalY - panelLocalY) ? headLocalY - panelLocalY : 0;
  return {
    glintX: Math.max(-1, Math.min(1, dx * 0.85)),
    glintY: Math.max(-1, Math.min(1, dy * 0.85)),
  };
}
