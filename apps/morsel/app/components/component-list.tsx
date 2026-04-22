// SPDX-License-Identifier: AGPL-3.0-or-later

import { PackageIcon } from "@primer/octicons-react";
import { NavList, useTheme } from "@primer/react";
import React from "react";
import type { Translations } from "~/util/i18n";
import type { DiagramNode } from "~/util/lsp-bridge";
import { invertSvgColors } from "~/util/x6";

interface ComponentListProps {
  components: DiagramNode[] | null;
  onSelect: (name: string) => void;
  selectedName?: string | null;
  language?: string | null;
  translations?: Translations;
}

interface ComponentIconProps {
  iconSvg?: string;
  size?: number;
  darkMode?: boolean;
}

export const ComponentIcon = React.memo(function ComponentIcon(props: ComponentIconProps) {
  const { iconSvg, size = 20, darkMode } = props;

  if (!iconSvg) {
    return <PackageIcon size={size} />;
  }

  const displaySvg = invertSvgColors(iconSvg, !!darkMode);

  return (
    <div
      className="modelica-icon"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: displaySvg }}
    />
  );
});

const ComponentList = React.memo(function ComponentList(props: ComponentListProps) {
  const { components, onSelect, selectedName } = props;
  const { colorMode } = useTheme();
  const isDark = colorMode === "dark";

  if (!components) {
    return (
      <div className="p-3 text-center color-fg-muted">
        <em>{props.translations?.noClassSelected ?? "No class selected"}</em>
      </div>
    );
  }

  const validComponents = components.filter(
    (c) => c.properties?.classKind === "model" || c.properties?.classKind === "block",
  );

  if (validComponents.length === 0) {
    return (
      <div className="p-3 text-center color-fg-muted">
        <em>{props.translations?.noComponents ?? "No components"}</em>
      </div>
    );
  }

  return (
    <NavList className="height-full overflow-auto" style={{ flex: 1 }}>
      {validComponents.map((component) => (
        <NavList.Item
          key={component.id}
          aria-current={selectedName === component.id ? "page" : undefined}
          onClick={() => component.id && onSelect(component.id)}
        >
          <NavList.LeadingVisual>
            <ComponentIcon iconSvg={component.properties?.iconSvg} darkMode={isDark} />
          </NavList.LeadingVisual>
          <div style={{ display: "flex", width: "100%", gap: "8px", overflow: "hidden" }}>
            <div
              style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={component.id ?? undefined}
            >
              {component.id}
            </div>
            <div
              style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.7 }}
              title={component.properties?.className ?? undefined}
            >
              {component.properties?.className}
            </div>
          </div>
        </NavList.Item>
      ))}
    </NavList>
  );
});

export default ComponentList;
