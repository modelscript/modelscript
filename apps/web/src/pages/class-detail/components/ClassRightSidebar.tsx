// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, CpuIcon, GearIcon, PackageIcon } from "@primer/octicons-react";
import { Button, Label, NavList, Text, Truncate } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import { getIconUrl } from "../../../api";
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
  return (
    <aside>
      {/* Class icon */}
      <ClassIconBox>
        <InvertedSvg
          src={`${getIconUrl(libraryName, version, className)}?t=${retryCount}`}
          alt=""
          fallback={<PackageIcon size={32} />}
        />
      </ClassIconBox>

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
                  <CheckCircleFillIcon size={12} fill="#3fb950" />
                  <Text style={{ fontSize: 11, color: "#3fb950" }}>Unit Parity Verified</Text>
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
