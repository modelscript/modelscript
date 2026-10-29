// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CodeIcon,
  CpuIcon,
  DatabaseIcon,
  GitBranchIcon,
  PackageIcon,
  PersonIcon,
  ShieldCheckIcon,
  TagIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { NavList, useTheme } from "@primer/react";
import DOMPurify from "dompurify";
import React from "react";
import { getKindBadgeStyle } from "../ClassTree";
import type { Translations } from "./util/i18n";
import type { DiagramNode } from "./util/lsp-bridge";
import { invertSvgColors } from "./util/x6";

interface ComponentListProps {
  components: DiagramNode[] | null;
  onSelect: (name: string) => void;
  selectedName?: string | null | undefined;
  language?: string | null | undefined;
  translations?: Translations | undefined;
}

interface ComponentIconProps {
  iconSvg?: string | undefined;
  kind?: string | undefined;
  size?: number | undefined;
  darkMode?: boolean | undefined;
}

export function getSemanticKindIcon(kind: string | undefined, size = 16): React.ReactElement {
  const k = (kind || "")
    .toLowerCase()
    .replace(/^owl2-/, "")
    .replace(/^ontology-/, "");
  switch (k) {
    case "class":
      return <TagIcon size={size} style={{ color: "#ef4444", flexShrink: 0 }} />;
    case "definedclass":
    case "defined_class":
      return <ShieldCheckIcon size={size} style={{ color: "#f59e0b", flexShrink: 0 }} />;
    case "objectproperty":
    case "object-property":
      return <GitBranchIcon size={size} style={{ color: "#3b82f6", flexShrink: 0 }} />;
    case "dataproperty":
    case "data-property":
    case "datatype":
      return <DatabaseIcon size={size} style={{ color: "#10b981", flexShrink: 0 }} />;
    case "individual":
    case "namedindividual":
      return <PersonIcon size={size} style={{ color: "#a855f7", flexShrink: 0 }} />;
    case "model":
    case "block":
    case "partdefinition":
    case "partusage":
      return <CpuIcon size={size} style={{ color: "#06b6d4", flexShrink: 0 }} />;
    case "connector":
    case "portdefinition":
    case "portusage":
      return <WorkflowIcon size={size} style={{ color: "#eab308", flexShrink: 0 }} />;
    case "record":
    case "type":
    case "attributedefinition":
      return <DatabaseIcon size={size} style={{ color: "#3b82f6", flexShrink: 0 }} />;
    case "function":
    case "algorithm":
    case "actiondefinition":
      return <CodeIcon size={size} style={{ color: "#c084fc", flexShrink: 0 }} />;
    default:
      return <PackageIcon size={size} style={{ color: "var(--fgColor-muted, #64748b)", flexShrink: 0 }} />;
  }
}

export const ComponentIcon = React.memo(function ComponentIcon(props: ComponentIconProps) {
  const { iconSvg, kind, size = 18, darkMode } = props;

  if (!iconSvg) {
    return getSemanticKindIcon(kind, size - 2);
  }

  const displaySvg = invertSvgColors(iconSvg, !!darkMode);
  const rawSizedSvg = displaySvg
    .replace(/width=(["']).*?\1/, 'width="100%"')
    .replace(/height=(["']).*?\1/, 'height="100%"');
  const sizedSvg = DOMPurify.sanitize(rawSizedSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });

  return (
    <div
      className="modelica-icon"
      style={{ width: size, height: size, flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: sizedSvg }}
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

  const validComponents = components.filter((c) => {
    if (!c.id || c.id.startsWith("__diagram_")) return false;
    const kind = c.properties?.classKind?.toLowerCase();
    // Exclude Modelica connectors from the top-level components list
    if (kind && kind.includes("connector")) return false;
    return true;
  });

  if (validComponents.length === 0) {
    return (
      <div className="p-3 text-center color-fg-muted">
        <em>{props.translations?.noComponents ?? "No components"}</em>
      </div>
    );
  }

  return (
    <NavList className="height-full overflow-auto" style={{ flex: 1 }}>
      {validComponents.map((component) => {
        const rawKind = component.properties?.classKind || component.properties?.className || "component";
        const displayName = component.properties?.name || component.id;
        const badgeStyle = getKindBadgeStyle(rawKind, true);
        const rawClassName = component.properties?.className || "";
        const shortTypeName = rawClassName.includes(".")
          ? rawClassName.split(".").pop()
          : rawClassName.toLowerCase() !== rawKind.toLowerCase()
            ? rawClassName
            : undefined;

        return (
          <NavList.Item
            key={component.id}
            aria-current={selectedName === component.id ? "page" : undefined}
            onClick={() => component.id && onSelect(component.id)}
          >
            <NavList.LeadingVisual>
              <ComponentIcon iconSvg={component.properties?.iconSvg} kind={rawKind} darkMode={isDark} />
            </NavList.LeadingVisual>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                gap: "8px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: 500,
                  fontSize: 13,
                }}
                title={component.id ?? undefined}
              >
                {displayName}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                {shortTypeName && (
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--ms-font-mono, monospace)",
                      opacity: 0.65,
                      maxWidth: 96,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={rawClassName}
                  >
                    {shortTypeName}
                  </span>
                )}
                {badgeStyle && (
                  <span
                    style={{
                      fontSize: 9,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: badgeStyle.bg,
                      color: badgeStyle.color,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      fontWeight: 600,
                      fontFamily: "var(--ms-font-mono, monospace)",
                      lineHeight: "15px",
                    }}
                  >
                    {badgeStyle.label ?? rawKind}
                  </span>
                )}
              </div>
            </div>
          </NavList.Item>
        );
      })}
    </NavList>
  );
});

export default ComponentList;
