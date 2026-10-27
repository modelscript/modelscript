// SPDX-License-Identifier: AGPL-3.0-or-later

import { PackageIcon, PlugIcon, SearchIcon, SlidersIcon, XIcon } from "@primer/octicons-react";
import { Label, Text, TextInput } from "@primer/react";
import React, { useMemo, useState } from "react";
import { getIconUrl } from "../../../api";
import Box from "../../../components/Box";
import type { EnrichedComponent } from "../../../components/classTreeUtils";
import InvertedSvg from "../../../components/InvertedSvg";
import { JavadocSection, JavadocTable, JavadocTableWrap, SectionTitle, TypeMono } from "../styles";

export interface ClassParametersSectionProps {
  parameters?: EnrichedComponent[] | undefined;
  connectors?: EnrichedComponent[] | undefined;
  submodels?: EnrichedComponent[] | undefined;
  renderTypeCell: (typeName: string) => React.ReactNode;
  libraryName: string;
  version: string;
}

export const ClassParametersSection: React.FC<ClassParametersSectionProps> = ({
  parameters = [],
  connectors = [],
  submodels = [],
  renderTypeCell,
  libraryName,
  version,
}) => {
  const [memberFilter, setMemberFilter] = useState("");
  const totalCount = parameters.length + connectors.length + submodels.length;

  const { filteredParams, filteredConnectors, filteredSubmodels } = useMemo(() => {
    const q = memberFilter.trim().toLowerCase();
    if (!q) {
      return {
        filteredParams: parameters,
        filteredConnectors: connectors,
        filteredSubmodels: submodels,
      };
    }
    const matches = (c: EnrichedComponent) =>
      c.component_name.toLowerCase().includes(q) ||
      c.type_name.toLowerCase().includes(q) ||
      Boolean(c.description && c.description.toLowerCase().includes(q));
    return {
      filteredParams: parameters.filter(matches),
      filteredConnectors: connectors.filter(matches),
      filteredSubmodels: submodels.filter(matches),
    };
  }, [memberFilter, parameters, connectors, submodels]);

  return (
    <>
      {totalCount > 5 && (
        <Box mb={3} style={{ maxWidth: 360 }}>
          <TextInput
            leadingVisual={SearchIcon}
            trailingAction={
              memberFilter ? (
                <TextInput.Action onClick={() => setMemberFilter("")} icon={XIcon} aria-label="Clear member filter" />
              ) : undefined
            }
            placeholder={`Filter ${totalCount} declared members, ports, or parameters…`}
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            size="small"
            block
            style={{
              background: "var(--color-glass-bg)",
              border: "1px solid var(--color-border)",
              fontSize: 12,
            }}
          />
        </Box>
      )}

      {filteredParams.length > 0 && (
        <JavadocSection>
          <SectionTitle as="h3">
            <SlidersIcon size={14} /> Parameters, Attributes &amp; Constants ({filteredParams.length})
          </SectionTitle>
          <JavadocTableWrap>
            <JavadocTable>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Default</th>
                  <th>Unit</th>
                  <th>Variability</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {filteredParams.map((param) => (
                  <tr key={param.component_name}>
                    <td>
                      <Text
                        style={{
                          fontFamily: "var(--font-mono, monospace)",
                          fontWeight: 600,
                          color: "var(--color-text-heading)",
                        }}
                      >
                        {param.component_name}
                      </Text>
                    </td>
                    <td>{renderTypeCell(param.type_name)}</td>
                    <td>
                      <TypeMono>{param.defaultValue ?? "—"}</TypeMono>
                    </td>
                    <td>
                      {param.unit ? (
                        <Label variant="secondary" style={{ fontSize: 11, fontFamily: "monospace" }}>
                          {param.unit}
                        </Label>
                      ) : (
                        <TypeMono>—</TypeMono>
                      )}
                    </td>
                    <td>
                      <Label variant="accent" style={{ fontSize: 10 }}>
                        {param.variability || "parameter"}
                      </Label>
                    </td>
                    <td style={{ color: "var(--color-text-muted)", lineHeight: 1.5 }}>{param.description || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </JavadocTable>
          </JavadocTableWrap>
        </JavadocSection>
      )}

      {filteredConnectors.length > 0 && (
        <JavadocSection>
          <SectionTitle as="h3">
            <PlugIcon size={14} /> Connectors, Ports &amp; Terminals ({filteredConnectors.length})
          </SectionTitle>
          <JavadocTableWrap>
            <JavadocTable>
              <thead>
                <tr>
                  <th>Port / Connector</th>
                  <th>Type</th>
                  <th>Causality</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {filteredConnectors.map((conn) => (
                  <tr key={conn.component_name}>
                    <td>
                      <Box display="flex" alignItems="center" gap="8px">
                        <InvertedSvg
                          src={getIconUrl(libraryName, version, conn.type_name)}
                          fallback={<PlugIcon size={14} />}
                          alt=""
                          width={16}
                          height={16}
                        />
                        <Text
                          style={{
                            fontFamily: "var(--font-mono, monospace)",
                            fontWeight: 600,
                            color: "var(--color-text-heading)",
                          }}
                        >
                          {conn.component_name}
                        </Text>
                      </Box>
                    </td>
                    <td>{renderTypeCell(conn.type_name)}</td>
                    <td>
                      <Label
                        variant={
                          conn.causality === "input" ? "accent" : conn.causality === "output" ? "success" : "secondary"
                        }
                        style={{ fontSize: 10 }}
                      >
                        {conn.causality || "acausal"}
                      </Label>
                    </td>
                    <td style={{ color: "var(--color-text-muted)", lineHeight: 1.5 }}>{conn.description || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </JavadocTable>
          </JavadocTableWrap>
        </JavadocSection>
      )}

      {filteredSubmodels.length > 0 && (
        <JavadocSection>
          <SectionTitle as="h3">
            <PackageIcon size={14} /> Components, Parts &amp; Submodels ({filteredSubmodels.length})
          </SectionTitle>
          <JavadocTableWrap>
            <JavadocTable>
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Type</th>
                  <th>Modifiers</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubmodels.map((sub) => {
                  const allMods = [
                    ...(sub.defaultValue ? [{ modifier_name: "value", modifier_value: sub.defaultValue }] : []),
                    ...(sub.unit ? [{ modifier_name: "unit", modifier_value: sub.unit }] : []),
                    ...sub.otherModifiers,
                  ];
                  return (
                    <tr key={sub.component_name}>
                      <td>
                        <Box display="flex" alignItems="center" gap="8px">
                          <InvertedSvg
                            src={getIconUrl(libraryName, version, sub.type_name)}
                            fallback={<PackageIcon size={14} />}
                            alt=""
                            width={16}
                            height={16}
                          />
                          <Text
                            style={{
                              fontFamily: "var(--font-mono, monospace)",
                              fontWeight: 600,
                              color: "var(--color-text-heading)",
                            }}
                          >
                            {sub.component_name}
                          </Text>
                        </Box>
                      </td>
                      <td>{renderTypeCell(sub.type_name)}</td>
                      <td>
                        {allMods.length > 0 ? (
                          <Box display="flex" gap="4px" flexWrap="wrap">
                            {allMods.map((m, idx) => (
                              <Label key={idx} variant="secondary" style={{ fontSize: 10, fontFamily: "monospace" }}>
                                {m.modifier_name}
                                {m.modifier_value ? `=${m.modifier_value}` : ""}
                              </Label>
                            ))}
                          </Box>
                        ) : (
                          <TypeMono>—</TypeMono>
                        )}
                      </td>
                      <td style={{ color: "var(--color-text-muted)", lineHeight: 1.5 }}>{sub.description || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </JavadocTable>
          </JavadocTableWrap>
        </JavadocSection>
      )}
    </>
  );
};
