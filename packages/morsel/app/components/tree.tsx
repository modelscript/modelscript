// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaClassInstance, ModelicaLibrary, renderIcon } from "@modelscript/modelscript";
import { PackageIcon } from "@primer/octicons-react";
import { NavList } from "@primer/react";
import React from "react";

interface TreeWidgetProps {
  context: Context | null;
  onSelect: (classInstance: ModelicaClassInstance) => void;
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

  return <div ref={ref} style={{ width: 16, height: 16 }} />;
});

interface TreeNodeProps {
  element: ModelicaClassInstance;
  onSelect: (classInstance: ModelicaClassInstance) => void;
}

const TreeNode = React.memo(function TreeNode(props: TreeNodeProps) {
  const { element, onSelect } = props;

  const children: ModelicaClassInstance[] = [];
  for (const child of element.elements) {
    if (child instanceof ModelicaClassInstance) {
      children.push(child);
    }
  }

  return (
    <NavList.Item
      key={element.name}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(element);
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/json", JSON.stringify({ className: element.compositeName }));
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <NavList.LeadingVisual>
        <ClassIcon classInstance={element} />
      </NavList.LeadingVisual>
      {element.name}
      {children.length > 0 && (
        <NavList.SubNav>
          {children.map((child) => (
            <TreeNode key={child.name} element={child} onSelect={onSelect} />
          ))}
        </NavList.SubNav>
      )}
    </NavList.Item>
  );
});

interface LibraryGroupProps {
  library: ModelicaLibrary;
  onSelect: (classInstance: ModelicaClassInstance) => void;
}

const LibraryGroup = React.memo(function LibraryGroup(props: LibraryGroupProps) {
  const { library, onSelect } = props;
  const children: ModelicaClassInstance[] = [];
  for (const child of library.elements) {
    if (child instanceof ModelicaClassInstance) {
      children.push(child);
    }
  }

  return (
    <NavList.Group title={library.path} key={library.path}>
      {children.map((child) => (
        <TreeNode key={child.name} element={child} onSelect={onSelect} />
      ))}
    </NavList.Group>
  );
});

const TreeWidget = React.memo(function TreeWidget(props: TreeWidgetProps) {
  const elements: React.ReactNode[] = [];
  if (props.context) {
    for (const element of props.context.elements) {
      if (element instanceof ModelicaClassInstance) {
        elements.push(<TreeNode key={element.name} element={element} onSelect={props.onSelect} />);
      } else if (element instanceof ModelicaLibrary) {
        elements.push(<LibraryGroup key={element.path} library={element} onSelect={props.onSelect} />);
      }
    }
  }

  return (
    <NavList className="height-full overflow-auto" style={{ width: "300px" }}>
      {elements}
    </NavList>
  );
});

export default TreeWidget;
