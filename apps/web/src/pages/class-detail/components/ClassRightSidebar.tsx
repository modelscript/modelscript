// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, CpuIcon, GearIcon, PackageIcon } from "@primer/octicons-react";
import { Button, Label, NavList, Text, Truncate } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import { getDiagramUrl, getIconUrl } from "../../../api";
import Box from "../../../components/Box";
import { resolveTypeTargetUrl } from "../../../components/classTreeUtils";
import InvertedSvg from "../../../components/InvertedSvg";
import {
  ClassIconBox,
  ComponentIconWrap,
  DetailLabel,
  DetailRow,
  DetailValue,
  GlassCard,
  SectionTitle,
  TypeLink,
} from "../styles";
import type { ClassDetail, ClassSummary, DigitalThreadTwinInfo } from "../types";

export interface ClassRightSidebarProps {
  className: string;
  libraryName: string;
  version: string;
  cls: ClassDetail;
  allClasses: ClassSummary[];
  retryCount: number;
  twinInfo: DigitalThreadTwinInfo | null;
  onSelectMember: (targetUrl: string | null) => void;
  onNavigate: (path: string) => void;
}

export const ClassRightSidebar: React.FC<ClassRightSidebarProps> = ({
  className,
  libraryName,
  version,
  cls,
  allClasses,
  retryCount,
  twinInfo,
  onSelectMember,
  onNavigate,
}) => {
  const isModelica = libraryName.toLowerCase().includes("modelica");
  const isModelicaNoDiagram =
    isModelica &&
    (cls.classKind === "package" ||
      cls.classKind === "type" ||
      cls.classKind === "record" ||
      cls.classKind === "function" ||
      !cls.components?.some((c) => {
        const k = (c.classKind || "").toLowerCase();
        return (
          k === "model" ||
          k === "block" ||
          (!k && c.type_name && !["Real", "Integer", "Boolean", "String"].includes(c.type_name))
        );
      }));
  const hasDiagram = !isModelicaNoDiagram;

  const [activePreview, setActivePreview] = React.useState<"icon" | "diagram">("icon");
  const currentPreview = hasDiagram ? activePreview : "icon";
  const iconUrl = `${getIconUrl(libraryName, version, className)}?v=${version}&t=${retryCount}`;
  const diagramUrl = `${getDiagramUrl(libraryName, version, className)}?v=${version}&t=${retryCount}`;

  return (
    <aside>
      {/* Class Visual Preview Box */}
      <Box mb={3}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <SectionTitle as="h3" style={{ margin: 0 }}>
            {hasDiagram ? "Visual Preview" : "Class Icon"}
          </SectionTitle>
          {hasDiagram && (
            <Box display="flex" gap={1}>
              <button
                onClick={() => setActivePreview("icon")}
                title="Component Icon View"
                style={{
                  background:
                    currentPreview === "icon" ? "var(--color-accent-cyan, #06b6d4)" : "rgba(255, 255, 255, 0.05)",
                  color: currentPreview === "icon" ? "#ffffff" : "var(--color-text-muted)",
                  border: "none",
                  borderRadius: "4px",
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                Icon
              </button>
              <button
                onClick={() => setActivePreview("diagram")}
                title="Schematic Diagram View"
                style={{
                  background:
                    currentPreview === "diagram" ? "var(--color-accent-cyan, #06b6d4)" : "rgba(255, 255, 255, 0.05)",
                  color: currentPreview === "diagram" ? "#ffffff" : "var(--color-text-muted)",
                  border: "none",
                  borderRadius: "4px",
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                Diagram
              </button>
            </Box>
          )}
        </Box>
        <ClassIconBox>
          <InvertedSvg
            key={currentPreview}
            src={currentPreview === "icon" ? iconUrl : diagramUrl}
            alt={`${className} ${currentPreview}`}
            fallback={
              <Box
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                gap={2}
                style={{
                  padding: "16px",
                  textAlign: "center",
                  color: "var(--color-text-muted)",
                }}
              >
                <PackageIcon size={32} />
                <span
                  style={{ fontSize: "11px", fontFamily: "var(--font-mono, monospace)", textTransform: "uppercase" }}
                >
                  {cls.classKind} · {className.split(".").pop()}
                </span>
              </Box>
            }
          />
        </ClassIconBox>
      </Box>

      {/* Class info */}
      <SectionTitle as="h3">Class Details</SectionTitle>
      <GlassCard>
        <DetailRow>
          <DetailLabel>Name</DetailLabel>
          <DetailValue>{className}</DetailValue>
        </DetailRow>
        <DetailRow>
          <DetailLabel>Kind</DetailLabel>
          <DetailValue>
            <Label variant="accent" style={{ fontSize: 11 }}>
              {cls.classKind}
            </Label>
          </DetailValue>
        </DetailRow>
        <DetailRow>
          <DetailLabel>Library</DetailLabel>
          <DetailValue>
            <TypeLink to={`/packages/${libraryName}/${version}`}>{libraryName}</TypeLink>
          </DetailValue>
        </DetailRow>
        <DetailRow>
          <DetailLabel>Version</DetailLabel>
          <DetailValue>{version}</DetailValue>
        </DetailRow>
        {cls.sourceFile && (
          <DetailRow>
            <DetailLabel>Source File</DetailLabel>
            <DetailValue style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>
              {cls.sourceFile}
            </DetailValue>
          </DetailRow>
        )}
        {cls.extends.length > 0 && (
          <DetailRow style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
            <DetailLabel>Extends (Inheritance)</DetailLabel>
            <Box display="flex" gap="6px" flexWrap="wrap">
              {cls.extends.map((base) => {
                const targetUrl = resolveTypeTargetUrl(base, libraryName, version, allClasses, className);
                return targetUrl ? (
                  <Link key={base} to={targetUrl} style={{ textDecoration: "none" }}>
                    <Label
                      variant="secondary"
                      style={{
                        fontSize: 11,
                        cursor: "pointer",
                        borderColor: "var(--color-accent-cyan, #06b6d4)",
                        color: "var(--color-accent-cyan, #06b6d4)",
                      }}
                    >
                      {base}
                    </Label>
                  </Link>
                ) : (
                  <Label key={base} variant="secondary" style={{ fontSize: 11 }}>
                    {base}
                  </Label>
                );
              })}
            </Box>
          </DetailRow>
        )}
      </GlassCard>

      {/* Digital Thread Counterparts */}
      {twinInfo && (
        <>
          <SectionTitle as="h3" style={{ marginTop: 24 }}>
            Digital Thread Counterparts
          </SectionTitle>
          <GlassCard style={{ border: "1px solid rgba(6, 182, 212, 0.4)", background: "rgba(6, 182, 212, 0.05)" }}>
            {twinInfo.twinTarget && (
              <DetailRow style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                <DetailLabel style={{ color: "#a855f7" }}>SysML v2 Twin</DetailLabel>
                <Box display="flex" alignItems="center" justifyContent="space-between" width="100%">
                  {resolveTypeTargetUrl(twinInfo.twinTarget, libraryName, version, allClasses, className) ? (
                    <TypeLink
                      to={resolveTypeTargetUrl(twinInfo.twinTarget, libraryName, version, allClasses, className)!}
                      style={{ color: "#c084fc", fontWeight: 600 }}
                    >
                      {twinInfo.twinTarget}
                    </TypeLink>
                  ) : (
                    <Text style={{ fontSize: 13, fontWeight: 600, fontFamily: "monospace" }}>
                      {twinInfo.twinTarget}
                    </Text>
                  )}
                  <Label
                    variant="accent"
                    style={{ fontSize: 10, background: "rgba(168, 85, 247, 0.2)", color: "#a855f7" }}
                  >
                    Twin
                  </Label>
                </Box>
                <Box display="flex" alignItems="center" gap={1} mt={1}>
                  <CheckCircleFillIcon size={12} fill="var(--ms-success)" />
                  <Text style={{ fontSize: 11, color: "var(--ms-success)" }}>Unit Parity Verified</Text>
                </Box>
              </DetailRow>
            )}

            {twinInfo.cadTarget && (
              <DetailRow style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, borderBottom: "none" }}>
                <DetailLabel style={{ color: "#fbbf24" }}>STEP CAD 3D Solid</DetailLabel>
                <Box display="flex" alignItems="center" justifyContent="space-between" width="100%">
                  <Text style={{ fontSize: 13, fontWeight: 600, fontFamily: "monospace" }}>{twinInfo.cadTarget}</Text>
                  <Label
                    variant="accent"
                    style={{ fontSize: 10, background: "rgba(251, 191, 36, 0.2)", color: "#fbbf24" }}
                  >
                    B-Rep
                  </Label>
                </Box>
                <Button
                  size="small"
                  variant="primary"
                  leadingVisual={CpuIcon}
                  onClick={() => {
                    const cadClassUrl = resolveTypeTargetUrl(
                      twinInfo.cadTarget!,
                      libraryName,
                      version,
                      allClasses,
                      className,
                    );
                    if (cadClassUrl && cadClassUrl.includes("/classes/")) {
                      onNavigate(cadClassUrl);
                    } else {
                      onNavigate(`/packages/${libraryName}/${version}?tab=artifacts`);
                    }
                  }}
                  style={{ marginTop: 6, width: "100%" }}
                >
                  Open 3D CAD Viewer
                </Button>
              </DetailRow>
            )}
          </GlassCard>
        </>
      )}

      {/* Components Quick-Jump List */}
      {cls.components.length > 0 && (
        <>
          <SectionTitle as="h3" style={{ marginTop: 24 }}>
            Declared Members ({cls.components.length})
          </SectionTitle>
          <GlassCard style={{ padding: "8px", maxHeight: "calc(100vh - 400px)", overflowY: "auto" }}>
            <NavList>
              {cls.components.map((comp) => {
                const targetUrl = resolveTypeTargetUrl(comp.type_name, libraryName, version, allClasses, className);
                return (
                  <NavList.Item
                    key={comp.component_name}
                    style={{ color: "var(--color-text-primary)", cursor: "pointer" }}
                    onClick={(e) => {
                      e.preventDefault();
                      onSelectMember(targetUrl);
                    }}
                  >
                    <NavList.LeadingVisual>
                      <ComponentIconWrap>
                        <InvertedSvg
                          src={getIconUrl(libraryName, version, comp.type_name)}
                          fallback={<GearIcon size={15} />}
                          alt=""
                        />
                      </ComponentIconWrap>
                    </NavList.LeadingVisual>
                    <Box fontWeight="bold" style={{ color: "var(--color-text-heading)" }}>
                      {comp.component_name}
                    </Box>
                    <Box fontSize="12px" opacity={0.75} style={{ fontFamily: "var(--font-mono, monospace)" }}>
                      <Truncate title={comp.type_name}>{comp.type_name}</Truncate>
                    </Box>
                    {comp.description && (
                      <Box fontSize="12px" opacity={0.8} mt={1}>
                        {comp.description}
                      </Box>
                    )}
                  </NavList.Item>
                );
              })}
            </NavList>
          </GlassCard>
        </>
      )}
    </aside>
  );
};
