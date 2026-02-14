// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaClassInstance, ModelicaElement, ModelicaLibrary, renderIcon } from "@modelscript/modelscript";
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

function ClassIcon(props: ClassIconProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const svg = React.useMemo(() => renderIcon(props.classInstance, undefined, true, undefined), [props.classInstance]);

  React.useEffect(() => {
    if (ref.current && svg && svg.children().length > 0) {
      ref.current.innerHTML = svg.svg();
    }
  }, [svg]);

  if (!svg || svg.children().length === 0) {
    return <PackageIcon />;
  }

  return <div ref={ref} style={{ width: 16, height: 16 }} />;
}

export default function TreeWidget(props: TreeWidgetProps) {
  const renderElement = (element: ModelicaElement) => {
    if (element instanceof ModelicaClassInstance) {
      const children: React.ReactNode[] = [];
      for (const child of element.elements) {
        if (child instanceof ModelicaClassInstance) {
          children.push(renderElement(child));
        }
      }
      return (
        <NavList.Item
          key={element.name}
          onClick={(e) => {
            e.stopPropagation();
            props.onSelect(element);
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
          {children.length > 0 && <NavList.SubNav>{children}</NavList.SubNav>}
        </NavList.Item>
      );
    } else if (element instanceof ModelicaLibrary) {
      const children: React.ReactNode[] = [];
      for (const child of element.elements) {
        if (child instanceof ModelicaClassInstance) {
          children.push(renderElement(child));
        }
      }
      return (
        <NavList.Group title={element.path} key={element.path}>
          {children}
        </NavList.Group>
      );
    }
    return null;
  };

  const elements: React.ReactNode[] = [];
  if (props.context) {
    for (const element of props.context.elements) {
      elements.push(renderElement(element));
    }
  }

  return (
    <NavList className="height-full overflow-auto" style={{ width: "300px" }}>
      {elements}
    </NavList>
  );
}
