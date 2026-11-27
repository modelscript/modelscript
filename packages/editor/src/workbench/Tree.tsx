// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Library tree widget backed by LSP requests.
 *
 * All data comes from `modelscript/getLibraryTree` and
 * `modelscript/searchClasses` — no in-process `Context` required.
 */

import {
  ChevronDownIcon,
  ChevronRightIcon,
  CpuIcon,
  FileDirectoryIcon,
  GlobeIcon,
  PackageIcon,
  ShareAndroidIcon,
  StackIcon,
  WorkflowIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { NavList, useTheme } from "@primer/react";
import DOMPurify from "dompurify";
import React from "react";
import { getKindBadgeStyle } from "../internal/kind-badge";
import Spinner from "../internal/Spinner";
import { getSemanticKindIcon } from "./ComponentList";
import { clearPlacement } from "./placement";
import { publishCstWorkerForeignSymbols } from "./util/cst-edit-client";
import {
  getClassIcon,
  getLibraryTree,
  getMountedLibraries,
  globalClassIconCache,
  searchClasses,
  type TreeNodeInfo,
} from "./util/lsp-bridge";
import { invertSvgColors, normalizeSvgForIcon } from "./util/x6";

function publishTreeNodesToCstWorker(nodes: ReadonlyArray<TreeNodeInfo>): void {
  const batch: Record<
    string,
    {
      cleanName: string;
      shortName: string;
      sourceLanguage: string;
      explicitLanguage: string | null;
      params: Array<{ name: string; defaultValue: string }>;
    }
  > = {};
  let count = 0;
  for (const n of nodes) {
    if (
      n.classKind === "package" ||
      n.classKind === "loading-package" ||
      n.id.startsWith("__LIB__:") ||
      n.id.startsWith("__LOADING__:")
    ) {
      continue;
    }
    const rawName = (n.compositeName ?? n.name ?? "")
      .replace(/^__LIB__:[^/]+\//, "")
      .replace(/^__LIB__:/, "")
      .trim();
    if (!rawName) continue;
    const nodeLang = (n as { language?: string | undefined }).language;
    const lang = (nodeLang ?? "").toLowerCase();
    if (!lang || lang === "pscad") continue;
    const shortName = rawName.split(/[.:/]/).filter(Boolean).pop() ?? rawName;
    batch[rawName] = {
      cleanName: rawName,
      shortName,
      sourceLanguage: lang,
      explicitLanguage: lang,
      params: [],
    };
    count++;
  }
  if (count > 0) {
    publishCstWorkerForeignSymbols(batch);
  }
}

// ────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────

interface TreeWidgetProps {
  /** LSP document URI (used as context for requests). */
  uri: string;
  /** Called when user double-clicks a class to open it. */
  onSelect: (className: string, kind: string) => void;
  /** Called when user single-clicks a class (highlight on diagram). */
  onHighlight?: ((className: string) => void) | undefined;
  width?: number | string | undefined;
  filter?: string | undefined;
  /** Incremented to force a re-fetch. */
  version?: number | undefined;
  language?: string | null | undefined;
  selectedClassName?: string | null | undefined;
  colorMode?: "dark" | "light" | undefined;
}

// ────────────────────────────────────────────────────────────────────
// Icon component (fetches SVG from LSP with caching)
// ────────────────────────────────────────────────────────────────────

const iconCache = globalClassIconCache;

function getFallbackTreeIcon(className: string, classKind?: string, nodeId?: string, depth = 0): React.ReactElement {
  const clean = className.startsWith("__LIB__:") ? className.slice("__LIB__:".length) : className;
  const k = (classKind || "").toLowerCase();
  const n = (clean || "").toLowerCase();
  const id = (nodeId || "").toLowerCase();

  if (k === "loading-package") {
    return <Spinner size={16} srText="Loading library..." />;
  }
  if (k === "owl2-folder" || k === "ontology-folder") {
    return (
      <span style={{ color: "#f59e0b", flexShrink: 0, display: "inline-flex" }}>
        <FileDirectoryIcon size={16} />
      </span>
    );
  }
  if (k === "owl2-ontology" || id.startsWith("__owl2") || /\.(owl|owl2|ofn|fss|ttl)$/i.test(n)) {
    return (
      <span style={{ color: "#ec4899", flexShrink: 0, display: "inline-flex" }}>
        <ShareAndroidIcon size={16} />
      </span>
    );
  }
  if (k === "ontology-package" || id === "__ontology_root__" || n.includes("ontology (polyglot)")) {
    return (
      <span style={{ color: "#a855f7", flexShrink: 0, display: "inline-flex" }}>
        <GlobeIcon size={16} />
      </span>
    );
  }
  if (
    k.startsWith("owl2-") ||
    k.startsWith("ontology-") ||
    k === "objectproperty" ||
    k === "dataproperty" ||
    k === "individual"
  ) {
    return getSemanticKindIcon(k, 16);
  }
  if (k.includes("sysml") || /\.(sysml|sysml2|kerml)$/i.test(n) || n === "sysml2" || n === "sysml") {
    return (
      <span style={{ color: "#8b5cf6", flexShrink: 0, display: "inline-flex" }}>
        <WorkflowIcon size={16} />
      </span>
    );
  }
  if (/\.(step|stp|p21|scad)$/i.test(n) || k.includes("cad") || k.includes("product")) {
    return (
      <span style={{ color: "#10b981", flexShrink: 0, display: "inline-flex" }}>
        <StackIcon size={16} />
      </span>
    );
  }
  if (/\.(pscx|pslx|pswx|raw)$/i.test(n) || n === "pscad") {
    return (
      <span style={{ color: "#eab308", flexShrink: 0, display: "inline-flex" }}>
        <ZapIcon size={16} />
      </span>
    );
  }
  if (depth === 0 && (n === "modelica" || n === "complex" || n === "modelicaservices" || /\.mo$/i.test(n))) {
    return (
      <span style={{ color: "#06b6d4", flexShrink: 0, display: "inline-flex" }}>
        <CpuIcon size={16} />
      </span>
    );
  }
  if (k && k !== "package" && k !== "class") {
    return getSemanticKindIcon(k, 16);
  }
  return (
    <span style={{ color: "var(--fgColor-muted, #64748b)", flexShrink: 0, display: "inline-flex" }}>
      <PackageIcon size={16} />
    </span>
  );
}

function ClassIcon({
  className,
  classKind,
  nodeId,
  depth = 0,
  iconSvg: propSvg,
  colorMode: propColorMode,
}: {
  className: string;
  classKind?: string | undefined;
  nodeId?: string | undefined;
  depth?: number | undefined;
  iconSvg?: string | null | undefined;
  colorMode?: "dark" | "light" | undefined;
}) {
  const cleanClassName = className.startsWith("__LIB__:") ? className.slice("__LIB__:".length) : className;
  const { colorMode, resolvedColorMode } = useTheme();
  const isDark = propColorMode
    ? propColorMode === "dark"
    : colorMode === "dark" || colorMode === "night" || resolvedColorMode === "dark" || resolvedColorMode === "night";
  const [svg, setSvg] = React.useState<string | null>(propSvg ?? iconCache.get(cleanClassName) ?? null);
  const requested = React.useRef(false);

  React.useEffect(() => {
    if (propSvg) {
      setSvg(propSvg);
      iconCache.set(cleanClassName, propSvg);
      return;
    }
    if (iconCache.has(cleanClassName)) {
      setSvg(iconCache.get(cleanClassName) ?? null);
      return;
    }
    if (requested.current) return;
    requested.current = true;

    getClassIcon(cleanClassName)
      .then((result) => {
        iconCache.set(cleanClassName, result);
        setSvg(result);
      })
      .catch(() => {
        iconCache.set(cleanClassName, null);
      });
  }, [cleanClassName, propSvg]);

  if (!svg) {
    return getFallbackTreeIcon(cleanClassName, classKind, nodeId, depth);
  }

  const inverted = invertSvgColors(svg, isDark);
  const rawSizedSvg = normalizeSvgForIcon(inverted);
  const displaySvg = DOMPurify.sanitize(rawSizedSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
  return (
    <div
      className="modelica-icon"
      style={{
        width: 20,
        height: 20,
        minWidth: 20,
        minHeight: 20,
        maxWidth: 20,
        maxHeight: 20,
        flexShrink: 0,
        overflow: "hidden",
        position: "relative",
      }}
      dangerouslySetInnerHTML={{ __html: displaySvg }}
    />
  );
}

// ────────────────────────────────────────────────────────────────────
// Tree Node
// ────────────────────────────────────────────────────────────────────

interface TreeNodeProps {
  node: TreeNodeInfo;
  uri: string;
  onSelect: (className: string, kind: string) => void;
  onHighlight?: ((className: string) => void) | undefined;
  depth: number;
  showQualifiedName?: boolean | undefined;
  selectedClassName?: string | null | undefined;
  colorMode?: "dark" | "light" | undefined;
}

function setDragPreview(e: React.DragEvent, iconSvg: string | null | undefined, className: string, isDark = false) {
  if (typeof document === "undefined") return;
  const preview = document.createElement("div");
  preview.style.position = "fixed";
  preview.style.top = "-1000px";
  preview.style.left = "-1000px";
  preview.style.pointerEvents = "none";
  preview.style.display = "flex";
  preview.style.alignItems = "center";
  preview.style.justifyContent = "center";
  preview.style.borderRadius = "8px";
  preview.style.boxShadow = isDark ? "0 4px 16px rgba(0,0,0,0.55)" : "0 4px 14px rgba(15,23,42,0.22)";
  preview.style.border = isDark ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(15,23,42,0.14)";
  preview.style.background = isDark ? "rgba(30, 30, 34, 0.92)" : "rgba(255, 255, 255, 0.94)";

  let offsetX = 24;
  let offsetY = 24;
  if (iconSvg) {
    preview.style.width = "48px";
    preview.style.height = "48px";
    preview.style.padding = "4px";
    const adaptedSvg = normalizeSvgForIcon(invertSvgColors(iconSvg, isDark));
    preview.innerHTML = DOMPurify.sanitize(adaptedSvg, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });
    const svgEl = preview.querySelector("svg");
    if (svgEl) {
      svgEl.style.width = "40px";
      svgEl.style.height = "40px";
      svgEl.style.display = "block";
    }
  } else {
    const shortName = className.split(".").pop() || className;
    preview.style.padding = "6px 10px";
    preview.style.fontSize = "12px";
    preview.style.fontWeight = "600";
    preview.style.color = isDark ? "#f4f4f5" : "#0f172a";
    preview.style.whiteSpace = "nowrap";
    preview.textContent = shortName;
    offsetX = 16;
    offsetY = 14;
  }

  document.body.appendChild(preview);
  try {
    e.dataTransfer.setDragImage(preview, offsetX, offsetY);
  } catch {
    // ignore if browser doesn't support setDragImage
  }
  setTimeout(() => {
    if (preview.parentNode) document.body.removeChild(preview);
  }, 0);
}

const TreeNode = React.memo(function TreeNode(props: TreeNodeProps) {
  const {
    node,
    uri,
    onSelect,
    onHighlight,
    depth,
    showQualifiedName,
    selectedClassName,
    colorMode: propColorMode,
  } = props;
  const { colorMode: themeColorMode, resolvedColorMode } = useTheme();
  const isDark = propColorMode
    ? propColorMode === "dark"
    : themeColorMode === "dark" ||
      themeColorMode === "night" ||
      resolvedColorMode === "dark" ||
      resolvedColorMode === "night";
  const [expanded, setExpanded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [children, setChildren] = React.useState<TreeNodeInfo[] | null>(null);
  const [hovered, setHovered] = React.useState(false);

  const displayName = showQualifiedName ? (node.compositeName ?? node.name) : (node.localizedName ?? node.name);
  const compositeName = node.compositeName ?? node.name;
  const isSelected = selectedClassName != null && compositeName === selectedClassName;
  const hasChildren = Boolean(node.hasChildren && !showQualifiedName);

  const toggleExpand = React.useCallback(() => {
    setExpanded((prev) => {
      if (!prev && node.hasChildren) {
        setLoading(true);
        getLibraryTree(uri, node.id)
          .then((result) => {
            setChildren(result);
            publishTreeNodesToCstWorker(result);
            setLoading(false);
          })
          .catch(() => {
            setChildren([]);
            setLoading(false);
          });
      } else if (prev) {
        setChildren(null);
      }
      return !prev;
    });
  }, [node.id, node.hasChildren, uri]);

  const handleMouseEnter = () => {
    setHovered(true);
  };

  return (
    <>
      <li
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={isSelected}
        tabIndex={0}
        style={{
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          padding: "6px 8px",
          paddingLeft: `${8 + depth * 16}px`,
          margin: "0 8px",
          cursor: node.classKind === "loading-package" ? "default" : "pointer",
          fontSize: 14,
          color: "var(--fgColor-default, var(--color-fg-default))",
          backgroundColor: isSelected
            ? "var(--control-transparent-bgColor-selected, var(--color-action-list-item-default-selected-bg, rgba(177, 186, 196, 0.2)))"
            : hovered
              ? "var(--control-transparent-bgColor-hover, var(--color-action-list-item-default-hover-bg, rgba(177, 186, 196, 0.12)))"
              : "transparent",
          borderRadius: 6,
          gap: 8,
          userSelect: "none",
          transition: "background-color 0.1s ease",
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation();
          if (node.classKind === "loading-package") return;
          onHighlight?.(compositeName);
          // Let onDoubleClick handle the second click of a double-click without re-toggling or double-loading
          if (e.detail >= 2) return;
          const isNonLoadableContainer =
            node.classKind === "package" ||
            node.id.startsWith("__LIB__:") ||
            node.id.startsWith("__LOADING__:") ||
            node.id.startsWith("__ONTOLOGY__:");
          if (isNonLoadableContainer) {
            if (hasChildren) toggleExpand();
            return;
          }
          const isCoarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
          if (hasChildren) {
            toggleExpand();
            if (isCoarsePointer) {
              onSelect(compositeName, node.classKind ?? "class");
            }
          } else if ((node as { uri?: string | undefined }).uri === uri || isCoarsePointer) {
            onSelect(compositeName, node.classKind ?? "class");
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          const isNonLoadableContainer =
            node.classKind === "loading-package" ||
            node.classKind === "package" ||
            node.id.startsWith("__LIB__:") ||
            node.id.startsWith("__LOADING__:") ||
            node.id.startsWith("__ONTOLOGY__:");
          if (isNonLoadableContainer) return;
          onHighlight?.(compositeName);
          onSelect(compositeName, node.classKind ?? "class");
        }}
        onKeyDown={(e) => {
          if (node.classKind === "loading-package") return;
          const isNonLoadableContainer =
            node.classKind === "package" ||
            node.id.startsWith("__LIB__:") ||
            node.id.startsWith("__LOADING__:") ||
            node.id.startsWith("__ONTOLOGY__:");
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onHighlight?.(compositeName);
            if (isNonLoadableContainer) {
              if (hasChildren) toggleExpand();
              return;
            }
            if (hasChildren) {
              if (e.key === " ") {
                toggleExpand();
              } else {
                onSelect(compositeName, node.classKind ?? "class");
              }
            } else {
              onSelect(compositeName, node.classKind ?? "class");
            }
          } else if (e.key === "ArrowRight") {
            if (hasChildren && !expanded) {
              e.preventDefault();
              e.stopPropagation();
              toggleExpand();
            }
          } else if (e.key === "ArrowLeft") {
            if (hasChildren && expanded) {
              e.preventDefault();
              e.stopPropagation();
              toggleExpand();
            }
          }
        }}
        draggable={
          node.classKind !== "loading-package" &&
          node.classKind !== "package" &&
          !node.id.startsWith("__LIB__:") &&
          !node.id.startsWith("__LOADING__:") &&
          !node.id.startsWith("__ONTOLOGY__:")
        }
        onDragStart={(e) => {
          if (
            node.classKind === "loading-package" ||
            node.classKind === "package" ||
            node.id.startsWith("__LIB__:") ||
            node.id.startsWith("__LOADING__:") ||
            node.id.startsWith("__ONTOLOGY__:")
          ) {
            e.preventDefault();
            return;
          }
          const cleanCompositeName = compositeName.replace(/^__LIB__:[^/]+\//, "").replace(/^__LIB__:/, "");
          publishTreeNodesToCstWorker([node]);
          const iconSvg = node.iconSvg || iconCache.get(cleanCompositeName) || iconCache.get(compositeName);
          const payload = {
            className: cleanCompositeName,
            classKind: node.classKind,
            iconSvg: iconSvg ?? null,
          };
          e.dataTransfer.setData("application/json", JSON.stringify(payload));
          e.dataTransfer.setData("text/plain", JSON.stringify(payload));
          e.dataTransfer.setData("application/vnd.modelscript.classname", cleanCompositeName);
          if (iconSvg) {
            e.dataTransfer.setData("application/vnd.modelscript.iconsvg", iconSvg);
          }
          e.dataTransfer.effectAllowed = "copy";

          setDragPreview(e, iconSvg, cleanCompositeName, isDark);

          // Clear any active click-to-place ghost; Ansatz Editor uses the native
          // setDragPreview icon for tree drags instead of a duplicate canvas ghost.
          clearPlacement();
        }}
        onDragEnd={() => {
          clearPlacement();
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {node.hasChildren && !showQualifiedName ? (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand();
              }}
              style={{
                display: "flex",
                cursor: "pointer",
                padding: "6px 6px 6px 16px",
                margin: "-4px -4px -4px -14px",
              }}
            >
              {loading ? (
                <Spinner size={12} srText="Loading children..." />
              ) : expanded ? (
                <ChevronDownIcon size={12} />
              ) : (
                <ChevronRightIcon size={12} />
              )}
            </span>
          ) : (
            <span style={{ width: 16 }} />
          )}
          <span style={{ display: "flex", alignItems: "center" }}>
            <ClassIcon
              className={compositeName}
              classKind={node.classKind}
              nodeId={node.id}
              depth={depth}
              iconSvg={node.iconSvg}
              colorMode={propColorMode}
            />
          </span>
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flex: 1,
            gap: 6,
            overflow: "hidden",
          }}
        >
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={displayName}>
            {displayName}
          </div>
          {(() => {
            const isFolder = node.classKind === "owl2-folder" || node.classKind === "ontology-folder";
            const nodeDesc = (node as { description?: string }).description;
            if (isFolder && nodeDesc) {
              return (
                <span
                  style={{
                    fontSize: 10,
                    opacity: 0.6,
                    fontFamily: "var(--ms-font-mono, monospace)",
                    flexShrink: 0,
                  }}
                >
                  {nodeDesc}
                </span>
              );
            }
            if (
              depth > 0 &&
              node.classKind &&
              !isFolder &&
              node.classKind !== "owl2-ontology" &&
              node.classKind !== "ontology-package"
            ) {
              const badge = getKindBadgeStyle(node.classKind, node.classKind.startsWith("owl2-"));
              if (badge) {
                return (
                  <span
                    style={{
                      fontSize: 9,
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: badge.bg,
                      color: badge.color,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      fontWeight: 600,
                      fontFamily: "var(--ms-font-mono, monospace)",
                      lineHeight: "14px",
                      flexShrink: 0,
                    }}
                  >
                    {badge.label ?? node.classKind}
                  </span>
                );
              }
            }
            return null;
          })()}
        </div>
      </li>
      {expanded &&
        !loading &&
        children?.map((child, i) => (
          <TreeNode
            key={`${child.name}-${i}`}
            node={child}
            uri={uri}
            onSelect={onSelect}
            onHighlight={onHighlight}
            depth={depth + 1}
            selectedClassName={selectedClassName}
            colorMode={propColorMode}
          />
        ))}
    </>
  );
});

// ────────────────────────────────────────────────────────────────────
// Search results
// ────────────────────────────────────────────────────────────────────

const SEARCH_RESULT_LIMIT = 50;

interface SearchState {
  results: TreeNodeInfo[];
  searching: boolean;
  totalMatches: number;
  done: boolean;
}

function inferLanguageFromUri(uri: string): string | null {
  if (!uri) return null;
  const lower = uri.toLowerCase();
  if (lower.endsWith(".mo") || lower.endsWith(".mos")) return "modelica";
  if (lower.endsWith(".sysml") || lower.endsWith(".sysml2") || lower.endsWith(".kerml")) return "sysml2";
  if (lower.endsWith(".owl") || lower.endsWith(".ttl") || lower.endsWith(".ofn") || lower.endsWith(".fss"))
    return "owl2";
  if (lower.endsWith(".step") || lower.endsWith(".stp") || lower.endsWith(".p21")) return "step";
  if (lower.endsWith(".scad")) return "scad";
  if (lower.endsWith(".cir") || lower.endsWith(".sp") || lower.endsWith(".net") || lower.endsWith(".lib"))
    return "spice";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".urdf") || lower.endsWith(".sdf") || lower.endsWith(".xacro")) return "urdf";
  if (lower.endsWith(".pscx") || lower.endsWith(".pslx") || lower.endsWith(".pswx") || lower.endsWith(".psmx"))
    return "pscad";
  return null;
}

const POLYGLOT_MODELICA_COMPONENT_LANGUAGES = new Set([
  "modelica",
  "modelscript",
  "psse",
  "pscad",
  "spice",
  "opendss",
  "cgmes",
  "powerfactory",
  "pslf",
  "urdf",
  "easy5",
  "simulink",
  "adams",
  "epanet",
  "swmm",
  "relap5",
  "olga",
]);

function isLanguageCompatible(nodeLanguage: string | undefined, nodeName: string, activeLanguage: string): boolean {
  const normActive = activeLanguage.toLowerCase();
  const normNodeLang = (nodeLanguage || "").toLowerCase();
  const normNodeName = nodeName.toLowerCase();

  // Modelica / ModelScript family
  if (normActive === "modelica" || normActive === "modelscript") {
    if (normNodeName === "sysml" || normNodeName === "kerml") return false;
    if (normNodeName === "modelica" || normNodeName === "complex" || normNodeName === "modelicaservices") return true;
    if (normNodeLang === "modelica" || normNodeLang === "modelscript") return true;
    return false;
  }

  // SysML family
  if (normActive === "sysml" || normActive === "sysml2" || normActive === "kerml") {
    if (normNodeName === "sysml" || normNodeName === "kerml") return true;
    if (normNodeLang === "sysml" || normNodeLang === "sysml2" || normNodeLang === "kerml") return true;
    return false;
  }

  // Exact or prefix match
  if (normNodeLang && normNodeLang === normActive) return true;
  if (normNodeName && normNodeName === normActive) return true;

  return false;
}

const TreeWidget = React.memo(function TreeWidget(props: TreeWidgetProps) {
  const filter = props.filter?.toLowerCase() ?? "";
  const effectiveLanguage = props.language || inferLanguageFromUri(props.uri);
  const [rootNodes, setRootNodes] = React.useState<TreeNodeInfo[]>([]);
  const [explicitlyInstalledNames, setExplicitlyInstalledNames] = React.useState<Set<string>>(new Set());
  const [searchState, setSearchState] = React.useState<SearchState>({
    results: [],
    searching: false,
    totalMatches: 0,
    done: false,
  });

  // Load root nodes
  React.useEffect(() => {
    if (!props.uri) return;

    Promise.all([getLibraryTree(props.uri), getMountedLibraries()])
      .then(([nodes, mountedState]) => {
        setRootNodes(nodes);
        publishTreeNodesToCstWorker(nodes);
        const explicit = new Set<string>();
        for (const m of mountedState.mounted) {
          if (m.explicitlyInstalled) {
            explicit.add(m.name.toLowerCase());
          }
        }
        setExplicitlyInstalledNames(explicit);
      })
      .catch((e) => console.warn("[tree] Failed to load root nodes:", e));
  }, [props.uri, props.version]);

  // Search
  React.useEffect(() => {
    if (!filter) {
      setSearchState({ results: [], searching: false, totalMatches: 0, done: false });
      return;
    }

    let cancelled = false;
    setSearchState({ searching: true, results: [], totalMatches: 0, done: false });

    searchClasses(filter, SEARCH_RESULT_LIMIT)
      .then((result) => {
        if (cancelled) return;
        publishTreeNodesToCstWorker(result.results);
        setSearchState({
          results: result.results,
          searching: false,
          totalMatches: result.results.length,
          done: true,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSearchState({ results: [], searching: false, totalMatches: 0, done: true });
      });

    return () => {
      cancelled = true;
    };
  }, [filter, props.version]);

  // Build elements
  const elements: React.ReactNode[] = [];

  if (filter) {
    // Search results
    for (const node of searchState.results) {
      const nodeLang = (node as { language?: string | undefined }).language;
      if (effectiveLanguage && nodeLang) {
        const isPolyglot =
          (effectiveLanguage === "modelica" || effectiveLanguage === "modelscript") &&
          POLYGLOT_MODELICA_COMPONENT_LANGUAGES.has(nodeLang.toLowerCase());
        if (!isPolyglot && !isLanguageCompatible(nodeLang, node.name, effectiveLanguage)) {
          continue;
        }
      }
      elements.push(
        <TreeNode
          key={node.compositeName ?? node.name}
          node={node}
          uri={props.uri}
          onSelect={props.onSelect}
          onHighlight={props.onHighlight}
          depth={0}
          showQualifiedName={true}
          selectedClassName={props.selectedClassName}
          colorMode={props.colorMode}
        />,
      );
    }
    if (searchState.searching) {
      elements.push(
        <li
          key="__searching__"
          style={{
            listStyle: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "12px 8px",
            margin: "0 8px",
            fontSize: 13,
            color: "var(--fgColor-muted, var(--color-fg-muted))",
            gap: 8,
          }}
        >
          <Spinner size={14} srText="Searching..." />
          Searching…
        </li>,
      );
    } else if (searchState.totalMatches > SEARCH_RESULT_LIMIT) {
      elements.push(
        <li
          key="__more__"
          style={{
            listStyle: "none",
            padding: "8px 16px",
            fontSize: 12,
            color: "var(--fgColor-muted, var(--color-fg-muted))",
            textAlign: "center",
            fontStyle: "italic",
          }}
        >
          Showing {SEARCH_RESULT_LIMIT} of {searchState.totalMatches}+ results
        </li>,
      );
    } else if (searchState.done && searchState.results.length === 0) {
      elements.push(
        <li
          key="__empty__"
          style={{
            listStyle: "none",
            padding: "12px 16px",
            fontSize: 13,
            color: "var(--fgColor-muted, var(--color-fg-muted))",
            textAlign: "center",
          }}
        >
          No results found
        </li>,
      );
    }
  } else {
    // Root tree nodes
    for (const node of rootNodes) {
      const isContainer =
        node.id.startsWith("__LIB__:") ||
        node.id.startsWith("__ONTOLOGY__:") ||
        node.id.startsWith("__LOADING__:") ||
        node.classKind === "ontology";

      const extNode = node as { language?: string | undefined; uri?: string | undefined };
      if (effectiveLanguage && isContainer) {
        if (
          !explicitlyInstalledNames.has(node.name.toLowerCase()) &&
          !isLanguageCompatible(extNode.language, node.name, effectiveLanguage)
        ) {
          continue;
        }
      } else if (effectiveLanguage && extNode.language && extNode.uri && extNode.uri !== props.uri) {
        if (!isLanguageCompatible(extNode.language, node.name, effectiveLanguage)) {
          continue;
        }
      }
      elements.push(
        <TreeNode
          key={node.id}
          node={node}
          uri={props.uri}
          onSelect={props.onSelect}
          onHighlight={props.onHighlight}
          depth={0}
          selectedClassName={props.selectedClassName}
          colorMode={props.colorMode}
        />,
      );
    }
  }

  return (
    <NavList className="height-full overflow-auto" style={{ width: props.width ?? "300px", flexShrink: 0 }}>
      {elements}
    </NavList>
  );
});

export default TreeWidget;
