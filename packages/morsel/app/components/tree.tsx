// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaClassInstance, ModelicaLibrary, renderIcon } from "@modelscript/modelscript";
import { ChevronDownIcon, ChevronRightIcon, PackageIcon } from "@primer/octicons-react";
import { NavList } from "@primer/react";
import React from "react";

interface TreeWidgetProps {
  context: Context | null;
  onSelect: (classInstance: ModelicaClassInstance) => void;
  width?: number | string;
  filter?: string;
  version?: number;
}

interface ClassIconProps {
  classInstance: ModelicaClassInstance;
}

const iconSvgCache = new Map<string, string | null>();

const ClassIcon = React.memo(function ClassIcon(props: ClassIconProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const cacheKey = props.classInstance.compositeName;
  const svgString = React.useMemo(() => {
    const cached = iconSvgCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const svg = renderIcon(props.classInstance, undefined, true, undefined);
    const result = svg && svg.children().length > 0 ? svg.svg() : null;
    iconSvgCache.set(cacheKey, result);
    return result;
  }, [cacheKey]);

  React.useEffect(() => {
    if (ref.current && svgString) {
      ref.current.innerHTML = svgString;
    }
  }, [svgString]);

  if (!svgString) {
    return <PackageIcon />;
  }

  return <div ref={ref} style={{ width: 20, height: 20 }} />;
});

interface TreeNodeProps {
  element: ModelicaClassInstance;
  onSelect: (classInstance: ModelicaClassInstance) => void;
  depth: number;
  showQualifiedName?: boolean;
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
  const { element, onSelect, depth, showQualifiedName } = props;
  const [expanded, setExpanded] = React.useState(false);
  const [hasChildren, setHasChildren] = React.useState<boolean | null>(null);
  const iconRef = React.useRef<HTMLSpanElement>(null);
  const dragImageRef = React.useRef<HTMLImageElement | null>(null);

  const children = expanded ? getClassChildren(element) : null;

  React.useEffect(() => {
    if (children !== null && hasChildren === null) {
      setHasChildren(children.length > 0);
    }
  }, [children, hasChildren]);

  const showChevron = (hasChildren === null || hasChildren === true) && !showQualifiedName;

  const handleMouseEnter = () => {
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
      <NavList.Item
        onClick={(e) => {
          e.stopPropagation();
          if (!showQualifiedName && hasChildren !== false) {
            setExpanded((prev) => !prev);
          } else {
            onSelect(element);
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onSelect(element);
        }}
        onMouseEnter={handleMouseEnter}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("application/json", JSON.stringify({ className: element.compositeName }));
          e.dataTransfer.effectAllowed = "copy";

          if (dragImageRef.current && dragImageRef.current.complete) {
            e.dataTransfer.setDragImage(dragImageRef.current, 20, 20);
          } else if (iconRef.current) {
            e.dataTransfer.setDragImage(iconRef.current, 10, 10);
          }
        }}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <NavList.LeadingVisual>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {showChevron ? (
              expanded ? (
                <ChevronDownIcon size={12} />
              ) : (
                <ChevronRightIcon size={12} />
              )
            ) : (
              <span style={{ width: 12 }} />
            )}
            <span ref={iconRef}>
              <ClassIcon classInstance={element} />
            </span>
          </span>
        </NavList.LeadingVisual>
        {showQualifiedName ? element.compositeName : element.name}
      </NavList.Item>
      {expanded &&
        children?.map((child) => <TreeNode key={child.name} element={child} onSelect={onSelect} depth={depth + 1} />)}
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
        children?.map((child) => <TreeNode key={child.name} element={child} onSelect={onSelect} depth={1} />)}
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
          <TreeNode key={c.compositeName} element={c} onSelect={props.onSelect} depth={0} showQualifiedName={true} />
        )),
      );
    } else {
      for (const element of props.context.elements) {
        if (element instanceof ModelicaClassInstance) {
          elements.push(<TreeNode key={element.name} element={element} onSelect={props.onSelect} depth={0} />);
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
