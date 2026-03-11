// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaClassInstance, ModelicaLibrary, renderIcon } from "@modelscript/core";
import { ChevronDownIcon, ChevronRightIcon, PackageIcon } from "@primer/octicons-react";
import { NavList, useTheme } from "@primer/react";
import React from "react";
import { invertSvgColors } from "~/util/x6";

interface TreeWidgetProps {
  context: Context | null;
  onSelect: (classInstance: ModelicaClassInstance) => void;
  onHighlight?: (className: string) => void;
  width?: number | string;
  filter?: string;
  version?: number;
  language?: string | null;
  selectedClassName?: string | null;
}

interface ClassIconProps {
  classInstance: ModelicaClassInstance;
}

const iconSvgCache = new Map<string, string | null>();

const ClassIcon = React.memo(function ClassIcon(props: ClassIconProps) {
  const { colorMode } = useTheme();
  const isDark = colorMode === "dark";
  const cacheKey = props.classInstance.compositeName;
  const svgString = React.useMemo(() => {
    const cached = iconSvgCache.get(cacheKey);
    if (cached !== undefined) return cached;
    try {
      const svg = renderIcon(props.classInstance, undefined, true, undefined);
      const result = svg && svg.children().length > 0 ? svg.svg() : null;
      iconSvgCache.set(cacheKey, result);
      return result;
    } catch (e) {
      console.warn(`Failed to render icon for ${cacheKey}:`, e);
      iconSvgCache.set(cacheKey, null);
      return null;
    }
  }, [cacheKey]);

  if (!svgString) {
    return <PackageIcon />;
  }

  const displaySvg = invertSvgColors(svgString, isDark);

  return (
    <div className="modelica-icon" style={{ width: 20, height: 20 }} dangerouslySetInnerHTML={{ __html: displaySvg }} />
  );
});

interface TreeNodeProps {
  element: ModelicaClassInstance;
  onSelect: (classInstance: ModelicaClassInstance) => void;
  onHighlight?: (className: string) => void;
  depth: number;
  showQualifiedName?: boolean;
  language?: string | null;
  selectedClassName?: string | null;
}

function getClassChildren(element: ModelicaClassInstance): ModelicaClassInstance[] {
  const children: ModelicaClassInstance[] = [];
  for (const child of element.elements) {
    if (child instanceof ModelicaClassInstance) {
      children.push(child);
    }
  }
  return children;
}

const TreeNode = React.memo(function TreeNode(props: TreeNodeProps) {
  const { element, onSelect, onHighlight, depth, showQualifiedName, language, selectedClassName } = props;
  const [expanded, setExpanded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [children, setChildren] = React.useState<ModelicaClassInstance[] | null>(null);
  const [hasChildren, setHasChildren] = React.useState<boolean | null>(null);
  const iconRef = React.useRef<HTMLSpanElement>(null);
  const dragImageRef = React.useRef<HTMLImageElement | null>(null);
  const [hovered, setHovered] = React.useState(false);

  const toggleExpand = React.useCallback(() => {
    setExpanded((prev) => {
      if (!prev) {
        // Expanding: show spinner, defer loading to next frame
        setLoading(true);
        setTimeout(() => {
          const result = getClassChildren(element);
          setChildren(result);
          setHasChildren(result.length > 0);
          setLoading(false);
        }, 0);
      } else {
        setChildren(null);
      }
      return !prev;
    });
  }, [element]);

  const showChevron = (hasChildren === null || hasChildren === true) && !showQualifiedName;
  const isSelected = selectedClassName != null && element.compositeName === selectedClassName;

  const handleMouseEnter = () => {
    setHovered(true);
    if (!dragImageRef.current) {
      const svg = renderIcon(element, undefined, true, undefined);
      if (svg) {
        svg.size(40, 40);
        const svgString = svg.svg();
        const base64 = btoa(unescape(encodeURIComponent(svgString)));
        const url = "data:image/svg+xml;base64," + base64;
        const img = new Image();
        img.src = url;
        dragImageRef.current = img;
      }
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
          onHighlight?.(element.compositeName);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onHighlight?.(element.compositeName);
          onSelect(element);
        }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            "application/json",
            JSON.stringify({ className: element.compositeName, classKind: element.classKind }),
          );
          e.dataTransfer.effectAllowed = "copy";

          if (dragImageRef.current && dragImageRef.current.complete) {
            e.dataTransfer.setDragImage(dragImageRef.current, 20, 20);
          } else if (iconRef.current) {
            e.dataTransfer.setDragImage(iconRef.current, 10, 10);
          }
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {showChevron ? (
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
          <span ref={iconRef}>
            <ClassIcon classInstance={element} />
          </span>
        </span>
        <div
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={(showQualifiedName ? element.localizedCompositeName : element.localizedName) ?? undefined}
        >
          {showQualifiedName ? element.localizedCompositeName : element.localizedName}
        </div>
      </li>
      {expanded &&
        !loading &&
        children?.map((child, i) => (
          <TreeNode
            key={`${child.name}-${i}`}
            element={child}
            onSelect={onSelect}
            onHighlight={onHighlight}
            depth={depth + 1}
            language={language}
            selectedClassName={selectedClassName}
          />
        ))}
    </>
  );
});

interface LibraryGroupProps {
  library: ModelicaLibrary;
  onSelect: (classInstance: ModelicaClassInstance) => void;
}

const LibraryGroup = React.memo(function LibraryGroup(props: LibraryGroupProps) {
  const { library, onSelect } = props;
  const [expanded, setExpanded] = React.useState(false);

  const children = expanded
    ? (() => {
        const result: ModelicaClassInstance[] = [];
        for (const child of library.elements) {
          if (child instanceof ModelicaClassInstance) {
            result.push(child);
          }
        }
        return result;
      })()
    : null;

  return (
    <NavList.Group title={library.path}>
      <NavList.Item
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((prev) => !prev);
        }}
      >
        <NavList.LeadingVisual>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
            <PackageIcon />
          </span>
        </NavList.LeadingVisual>
        {library.path.split("/").pop() ?? library.path}
      </NavList.Item>
      {expanded &&
        children?.map((child, i) => (
          <TreeNode key={`${child.name}-${i}`} element={child} onSelect={onSelect} depth={1} language={undefined} />
        ))}
    </NavList.Group>
  );
});

const TreeWidget = React.memo(function TreeWidget(props: TreeWidgetProps) {
  const elements: React.ReactNode[] = [];
  const filter = props.filter?.toLowerCase() ?? "";

  if (props.context) {
    if (filter) {
      const matchingClasses: ModelicaClassInstance[] = [];

      const flatten = (element: ModelicaClassInstance | ModelicaLibrary) => {
        if (element instanceof ModelicaClassInstance) {
          if (element.compositeName.toLowerCase().includes(filter)) {
            matchingClasses.push(element);
          }
          for (const child of element.elements) {
            if (child instanceof ModelicaClassInstance) {
              flatten(child);
            }
          }
        } else if (element instanceof ModelicaLibrary) {
          for (const child of element.elements) {
            if (child instanceof ModelicaClassInstance) {
              flatten(child);
            }
          }
        }
      };

      for (const element of props.context.elements) {
        if (element instanceof ModelicaClassInstance || element instanceof ModelicaLibrary) {
          flatten(element);
        }
      }

      elements.push(
        ...matchingClasses.map((c) => (
          <TreeNode
            key={c.compositeName}
            element={c}
            onSelect={props.onSelect}
            onHighlight={props.onHighlight}
            depth={0}
            showQualifiedName={true}
            language={props.language}
            selectedClassName={props.selectedClassName}
          />
        )),
      );
    } else {
      for (const element of props.context.elements) {
        if (element instanceof ModelicaClassInstance) {
          elements.push(
            <TreeNode
              key={element.name}
              element={element}
              onSelect={props.onSelect}
              onHighlight={props.onHighlight}
              depth={0}
              language={props.language}
              selectedClassName={props.selectedClassName}
            />,
          );
        } else if (element instanceof ModelicaLibrary) {
          elements.push(<LibraryGroup key={element.path} library={element} onSelect={props.onSelect} />);
        }
      }
    }
  }

  return (
    <NavList className="height-full overflow-auto" style={{ width: props.width ?? "300px", flexShrink: 0 }}>
      {elements}
    </NavList>
  );
});

export default TreeWidget;
