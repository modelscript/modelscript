// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelicaClassInstance, renderIcon } from "@modelscript/modelscript";
import { PackageIcon } from "@primer/octicons-react";
import { NavList } from "@primer/react";
import React from "react";

interface ComponentListProps {
  classInstance: ModelicaClassInstance | null;
  onSelect: (name: string) => void;
  selectedName?: string | null;
}

interface ComponentIconProps {
  classInstance: ModelicaClassInstance;
}

const iconSvgCache = new Map<string, string | null>();

const ComponentIcon = React.memo(function ComponentIcon(props: ComponentIconProps) {
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

  return <div ref={ref} className="modelica-icon" style={{ width: 20, height: 20 }} />;
});

const ComponentList = React.memo(function ComponentList(props: ComponentListProps) {
  const { classInstance, onSelect, selectedName } = props;

  if (!classInstance) {
    return (
      <div className="p-3 text-center color-fg-muted">
        <em>No class selected</em>
      </div>
    );
  }

  const components = Array.from(classInstance.components);

  if (components.length === 0) {
    return (
      <div className="p-3 text-center color-fg-muted">
        <em>No components</em>
      </div>
    );
  }

  return (
    <NavList className="height-full overflow-auto" style={{ flex: 1 }}>
      {components.map((component) => (
        <NavList.Item
          key={component.name}
          aria-current={selectedName === component.name ? "page" : undefined}
          onClick={() => component.name && onSelect(component.name)}
        >
          <NavList.LeadingVisual>
            {component.classInstance ? <ComponentIcon classInstance={component.classInstance} /> : <PackageIcon />}
          </NavList.LeadingVisual>
          {component.name}
          <NavList.TrailingVisual>{component.classInstance?.name}</NavList.TrailingVisual>
        </NavList.Item>
      ))}
    </NavList>
  );
});

export default ComponentList;
