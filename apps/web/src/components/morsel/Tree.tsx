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
import { getKindBadgeStyle } from "../ClassTree";
import { getSemanticKindIcon } from "./ComponentList";
import { startPlacement } from "./placement";
import { getClassIcon, getLibraryTree, searchClasses, type TreeNodeInfo } from "./util/lsp-bridge";
import { invertSvgColors } from "./util/x6";

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
}

// ────────────────────────────────────────────────────────────────────
// Icon component (fetches SVG from LSP with caching)
// ────────────────────────────────────────────────────────────────────

const iconCache = new Map<string, string | null>();

function getFallbackTreeIcon(className: string, classKind?: string, nodeId?: string, depth = 0): React.ReactElement {
  const k = (classKind || "").toLowerCase();
  const n = (className || "").toLowerCase();
  const id = (nodeId || "").toLowerCase();

  if (k === "owl2-folder" || k === "ontology-folder") {
    return <FileDirectoryIcon size={16} style={{ color: "#f59e0b", flexShrink: 0 }} />;
  }
  if (k === "owl2-ontology" || id.startsWith("__owl2") || /\.(owl|owl2|ofn|fss|ttl)$/i.test(n)) {
    return <ShareAndroidIcon size={16} style={{ color: "#ec4899", flexShrink: 0 }} />;
  }
  if (k === "ontology-package" || id === "__ontology_root__" || n.includes("ontology (polyglot)")) {
    return <GlobeIcon size={16} style={{ color: "#a855f7", flexShrink: 0 }} />;
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
  if (k.includes("sysml") || /\.(sysml|sysml2|kerml)$/i.test(n) || n === "sysml2") {
    return <WorkflowIcon size={16} style={{ color: "#8b5cf6", flexShrink: 0 }} />;
  }
  if (/\.(step|stp|p21|scad)$/i.test(n) || k.includes("cad") || k.includes("product")) {
    return <StackIcon size={16} style={{ color: "#10b981", flexShrink: 0 }} />;
  }
  if (/\.(pscx|pslx|pswx|raw)$/i.test(n)) {
    return <ZapIcon size={16} style={{ color: "#eab308", flexShrink: 0 }} />;
  }
  if (depth === 0 && (n === "modelica" || n === "complex" || n === "modelicaservices" || /\.mo$/i.test(n))) {
    return <CpuIcon size={16} style={{ color: "#06b6d4", flexShrink: 0 }} />;
  }
  if (k && k !== "package" && k !== "class") {
    return getSemanticKindIcon(k, 16);
  }
  return <PackageIcon size={16} style={{ color: "var(--fgColor-muted, #64748b)", flexShrink: 0 }} />;
}

function ClassIcon({
  className,
  classKind,
  nodeId,
  depth = 0,
}: {
  className: string;
  classKind?: string | undefined;
  nodeId?: string | undefined;
  depth?: number | undefined;
}) {
  const { colorMode } = useTheme();
  const isDark = colorMode === "dark";
  const skipModelicaIconFetch = Boolean(
    classKind?.startsWith("owl2-") ||
    classKind?.startsWith("ontology-") ||
    nodeId?.startsWith("__owl2") ||
    nodeId?.startsWith("__ontology") ||
    /\.(owl|owl2|ofn|fss|ttl|sysml|sysml2|kerml|step|stp|scad|pscx|csv)$/i.test(className),
  );
  const [svg, setSvg] = React.useState<string | null>(
    skipModelicaIconFetch ? null : (iconCache.get(className) ?? null),
  );
  const requested = React.useRef(false);

  React.useEffect(() => {
    if (skipModelicaIconFetch) {
      setSvg(null);
      return;
    }
    if (iconCache.has(className)) {
      setSvg(iconCache.get(className) ?? null);
      return;
    }
    if (requested.current) return;
    requested.current = true;

    getClassIcon(className)
      .then((result) => {
        iconCache.set(className, result);
        setSvg(result);
      })
      .catch(() => {
        iconCache.set(className, null);
      });
  }, [className, skipModelicaIconFetch]);

  if (!svg) {
    return getFallbackTreeIcon(className, classKind, nodeId, depth);
  }

  const displaySvg = DOMPurify.sanitize(invertSvgColors(svg, isDark), {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
  return (
    <div className="modelica-icon" style={{ width: 20, height: 20 }} dangerouslySetInnerHTML={{ __html: displaySvg }} />
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
}

function setDragPreview(e: React.DragEvent, iconSvg: string | null | undefined, className: string) {
  if (typeof document === "undefined") return;
  const ghost = document.createElement("div");
  ghost.style.position = "fixed";
  ghost.style.top = "-9999px";
  ghost.style.left = "-9999px";
  ghost.style.width = "48px";
  ghost.style.height = "48px";
  ghost.style.display = "flex";
  ghost.style.alignItems = "center";
  ghost.style.justifyContent = "center";
  ghost.style.backgroundColor = "rgba(255, 255, 255, 0.95)";
  ghost.style.borderRadius = "8px";
  ghost.style.border = "1.5px solid #0969da";
  ghost.style.boxShadow = "0 6px 16px rgba(0, 0, 0, 0.25)";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "999999";
  ghost.style.overflow = "hidden";

  if (iconSvg && iconSvg.includes("<svg")) {
    ghost.innerHTML = DOMPurify.sanitize(iconSvg, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });
    const svgEl = ghost.querySelector("svg");
    if (svgEl) {
      svgEl.setAttribute("width", "36");
      svgEl.setAttribute("height", "36");
      svgEl.style.width = "36px";
      svgEl.style.height = "36px";
      svgEl.style.display = "block";
    }
  } else {
    const label = document.createElement("div");
    label.style.fontSize = "10px";
    label.style.fontWeight = "bold";
    label.style.color = "#0969da";
    label.style.textAlign = "center";
    label.style.lineHeight = "1.1";
    label.textContent = className.split(".").pop() || className;
    ghost.appendChild(label);
  }

  document.body.appendChild(ghost);
  try {
    e.dataTransfer.setDragImage(ghost, 24, 24);
  } catch {
    // ignore if browser doesn't support setDragImage
  }
  setTimeout(() => {
    if (ghost.parentNode) document.body.removeChild(ghost);
  }, 0);
}

const TreeNode = React.memo(function TreeNode(props: TreeNodeProps) {
  const { node, uri, onSelect, onHighlight, depth, showQualifiedName, selectedClassName } = props;
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
          cursor: "pointer",
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
          onHighlight?.(compositeName);
          const isCoarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
          if (hasChildren) {
            toggleExpand();
            if (isCoarsePointer && node.classKind && node.classKind !== "package") {
              onSelect(compositeName, node.classKind);
            }
          } else {
            onSelect(compositeName, node.classKind ?? "class");
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onHighlight?.(compositeName);
          onSelect(compositeName, node.classKind ?? "class");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onHighlight?.(compositeName);
            if (hasChildren) {
              toggleExpand();
              if (e.key === "Enter" && node.classKind && node.classKind !== "package") {
                onSelect(compositeName, node.classKind);
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
        draggable
        onDragStart={(e) => {
          const iconSvg = node.iconSvg || iconCache.get(compositeName);
          const payload = {
            className: compositeName,
            classKind: node.classKind,
            iconSvg: iconSvg ?? null,
          };
          e.dataTransfer.setData("application/json", JSON.stringify(payload));
          e.dataTransfer.setData("text/plain", JSON.stringify(payload));
          e.dataTransfer.setData("application/vnd.modelscript.classname", compositeName);
          if (iconSvg) {
            e.dataTransfer.setData("application/vnd.modelscript.iconsvg", iconSvg);
          }
          e.dataTransfer.effectAllowed = "copy";

          setDragPreview(e, iconSvg, compositeName);

          // Tell diagram editor that placement/drag mode started
          startPlacement({
            className: compositeName,
            classKind: node.classKind ?? "class",
            iconSvg: iconSvg ?? undefined,
          });
        }}
        onDragEnd={() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
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
                <span
                  style={{
                    display: "inline-block",
                    width: 12,
                    height: 12,
                    border: "2px solid var(--fgColor-muted, rgba(125, 133, 144, 0.4))",
                    borderTopColor: "var(--fgColor-default, var(--color-fg-default))",
                    borderRadius: "50%",
                    animation: "tree-spinner 0.6s linear infinite",
                  }}
                />
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
            <ClassIcon className={compositeName} classKind={node.classKind} nodeId={node.id} depth={depth} />
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
            if (isFolder && node.description) {
              return (
                <span
                  style={{
                    fontSize: 10,
                    opacity: 0.6,
                    fontFamily: "var(--ms-font-mono, monospace)",
                    flexShrink: 0,
                  }}
                >
                  {node.description}
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

// ────────────────────────────────────────────────────────────────────
// Main tree widget
// ────────────────────────────────────────────────────────────────────

const TreeWidget = React.memo(function TreeWidget(props: TreeWidgetProps) {
  const filter = props.filter?.toLowerCase() ?? "";
  const [rootNodes, setRootNodes] = React.useState<TreeNodeInfo[]>([]);
  const [searchState, setSearchState] = React.useState<SearchState>({
    results: [],
    searching: false,
    totalMatches: 0,
    done: false,
  });

  // Load root nodes
  React.useEffect(() => {
    if (!props.uri) return;

    console.log("[tree] Requesting getLibraryTree for", props.uri, "version=", props.version);
    getLibraryTree(props.uri)
      .then((nodes) => {
        console.log("[tree] Received root nodes:", nodes);
        setRootNodes(nodes);
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
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              border: "2px solid var(--fgColor-muted, rgba(125, 133, 144, 0.4))",
              borderTopColor: "var(--fgColor-default, var(--color-fg-default))",
              borderRadius: "50%",
              animation: "tree-spinner 0.6s linear infinite",
            }}
          />
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
      elements.push(
        <TreeNode
          key={node.id}
          node={node}
          uri={props.uri}
          onSelect={props.onSelect}
          onHighlight={props.onHighlight}
          depth={0}
          selectedClassName={props.selectedClassName}
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
