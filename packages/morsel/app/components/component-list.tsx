// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelicaClassInstance, renderIcon } from "@modelscript/modelscript";
import { PackageIcon } from "@primer/octicons-react";
import { NavList } from "@primer/react";
import React from "react";
import type { Translations } from "~/util/i18n";

interface ComponentListProps {
  classInstance: ModelicaClassInstance | null;
  onSelect: (name: string) => void;
  selectedName?: string | null;
  language?: string | null;
  translations?: Translations;
}

interface ComponentIconProps {
  classInstance: ModelicaClassInstance;
  size?: number;
}

const iconSvgCache = new Map<string, string | null>();

export const ComponentIcon = React.memo(function ComponentIcon(props: ComponentIconProps) {
  const { classInstance, size = 20 } = props;
  const cacheKey = classInstance.compositeName;
  const svgString = React.useMemo(() => {
    const cached = iconSvgCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const svg = renderIcon(classInstance, undefined, true, undefined);
    const result = svg && svg.children().length > 0 ? svg.svg() : null;
    iconSvgCache.set(cacheKey, result);
    return result;
  }, [cacheKey, classInstance]);

  if (!svgString) {
    return <PackageIcon size={size} />;
  }

  return (
    <div
      className="modelica-icon"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svgString }}
    />
  );
});

const ComponentList = React.memo(function ComponentList(props: ComponentListProps) {
  const { classInstance, onSelect, selectedName } = props;

  if (!classInstance) {
    return (
      <div className="p-3 text-center color-fg-muted">
        <em>{props.translations?.noClassSelected ?? "No class selected"}</em>
      </div>
    );
  }

  const components = Array.from(classInstance.components);

  if (components.length === 0) {
    return (
      <div className="p-3 text-center color-fg-muted">
        <em>{props.translations?.noComponents ?? "No components"}</em>
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
          <div style={{ display: "flex", width: "100%", gap: "8px", overflow: "hidden" }}>
            <div
              style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={component.localizedName ?? undefined}
            >
              {component.localizedName}
            </div>
            <div
              style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.7 }}
              title={component.classInstance?.localizedName ?? undefined}
            >
              {component.classInstance?.localizedName}
            </div>
          </div>
        </NavList.Item>
      ))}
    </NavList>
  );
});

export default ComponentList;
