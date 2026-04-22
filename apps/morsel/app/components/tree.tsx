// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Library tree widget backed by LSP requests.
 *
 * All data comes from `modelscript/getLibraryTree` and
 * `modelscript/searchClasses` — no in-process `Context` required.
 */

import { ChevronDownIcon, ChevronRightIcon, PackageIcon } from "@primer/octicons-react";
import { NavList, useTheme } from "@primer/react";
import React from "react";
import { getClassIcon, getLibraryTree, searchClasses, type TreeNodeInfo } from "~/util/lsp-bridge";
import { invertSvgColors } from "~/util/x6";

// ────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────

interface TreeWidgetProps {
  /** LSP document URI (used as context for requests). */
  uri: string;
  /** Called when user double-clicks a class to open it. */
  onSelect: (className: string, kind: string) => void;
  /** Called when user single-clicks a class (highlight on diagram). */
  onHighlight?: (className: string) => void;
  width?: number | string;
  filter?: string;
  /** Incremented to force a re-fetch. */
  version?: number;
  language?: string | null;
  selectedClassName?: string | null;
}

// ────────────────────────────────────────────────────────────────────
// Icon component (fetches SVG from LSP with caching)
// ────────────────────────────────────────────────────────────────────

const iconCache = new Map<string, string | null>();

function ClassIcon({ className }: { className: string }) {
  const { colorMode } = useTheme();
  const isDark = colorMode === "dark";
  const [svg, setSvg] = React.useState<string | null>(iconCache.get(className) ?? null);
  const requested = React.useRef(false);

  React.useEffect(() => {
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
  }, [className]);

  if (!svg) {
    return <PackageIcon />;
  }

  const displaySvg = invertSvgColors(svg, isDark);
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
  onHighlight?: (className: string) => void;
  depth: number;
  showQualifiedName?: boolean;
  selectedClassName?: string | null;
}

const TreeNode = React.memo(function TreeNode(props: TreeNodeProps) {
  const { node, uri, onSelect, onHighlight, depth, showQualifiedName, selectedClassName } = props;
  const [expanded, setExpanded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [children, setChildren] = React.useState<TreeNodeInfo[] | null>(null);
  const [hovered, setHovered] = React.useState(false);
  const dragImageRef = React.useRef<HTMLImageElement | null>(null);

  const displayName = showQualifiedName ? (node.compositeName ?? node.name) : (node.localizedName ?? node.name);
  const compositeName = node.compositeName ?? node.name;
  const isSelected = selectedClassName != null && compositeName === selectedClassName;

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
    // Prepare drag image
    if (!dragImageRef.current && node.iconSvg) {
      const base64 = btoa(unescape(encodeURIComponent(node.iconSvg)));
      const url = "data:image/svg+xml;base64," + base64;
      const img = new Image();
      img.src = url;
      dragImageRef.current = img;
    }
  };

  return (
    <>
      <li
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
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onHighlight?.(compositeName);
          onSelect(compositeName, node.kind ?? "class");
        }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            "application/json",
            JSON.stringify({
              className: compositeName,
              classKind: node.kind,
              iconSvg: node.iconSvg ?? null,
            }),
          );
          e.dataTransfer.effectAllowed = "copy";

          if (dragImageRef.current?.complete) {
            e.dataTransfer.setDragImage(dragImageRef.current, 20, 20);
          }
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
            <span style={{ width: 12 }} />
          )}
          <span>
            <ClassIcon className={compositeName} />
          </span>
        </span>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={displayName}>
          {displayName}
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

    getLibraryTree(props.uri)
      .then((nodes) => setRootNodes(nodes))
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
