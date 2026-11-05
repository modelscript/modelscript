// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BeakerIcon,
  BookIcon,
  FileCodeIcon,
  PackageIcon,
  SidebarExpandIcon,
  SlidersIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { Heading, IconButton, Label, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import styledImport from "styled-components";
import { getIconUrl, type ClassSummary } from "../../../api";
import Box from "../../../components/Box";
import Breadcrumbs from "../../../components/Breadcrumbs";
import { formatFormalSignature, resolveTypeTargetUrl } from "../../../components/classTreeUtils";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import { HeaderBar, TabBar, TabButton, TabCountBadge } from "../styles";
import type { ClassDetail, ClassTabId, JobStatus } from "../types";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

const HeroRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  width: 100%;

  @media (max-width: 640px) {
    flex-direction: column-reverse;
    gap: 14px;
  }
`;

const HeroLeft = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const HeroIconCard = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 14px;
  background: var(--ms-surface-hover, var(--color-canvas-subtle, rgba(255, 255, 255, 0.04)));
  border: 1px solid var(--ms-border, var(--color-border));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  transition:
    transform 0.2s ease,
    border-color 0.2s ease;
  padding: 6px;
  box-sizing: border-box;

  &:hover {
    border-color: var(--ms-brand, var(--color-accent-cyan, #06b6d4));
    transform: translateY(-2px);
  }

  img,
  svg {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  @media (max-width: 640px) {
    width: 56px;
    height: 56px;
    border-radius: 10px;
  }
`;

export interface ClassDetailHeaderProps {
  libraryName: string;
  version: string;
  className: string;
  cls: ClassDetail;
  jobStatus: JobStatus | null;
  activeTab: ClassTabId;
  setActiveTab: (tab: ClassTabId) => void;
  equationsCount: number;
  studiesCount?: number | undefined;
  hasCae?: boolean | undefined;
  treeCollapsed?: boolean | undefined;
  onToggleTreeCollapse?: (() => void) | undefined;
  onOpenLogs?: (() => void) | undefined;
  allClasses?: ClassSummary[] | undefined;
}

export const ClassDetailHeader: React.FC<ClassDetailHeaderProps> = ({
  libraryName,
  version,
  className,
  cls,
  jobStatus,
  activeTab,
  setActiveTab,
  equationsCount,
  studiesCount = 0,
  hasCae,
  treeCollapsed,
  onToggleTreeCollapse,
  onOpenLogs,
  allClasses = [],
}) => {
  const flagCae = useFeatureFlag("cae_cloud_solver");
  const showStudies = hasCae ?? flagCae;
  const signature = formatFormalSignature({
    className,
    classKind: cls.classKind,
    baseClasses: cls.baseClasses,
  });

  const [imgError, setImgError] = React.useState(false);
  React.useEffect(() => {
    setImgError(false);
  }, [className, libraryName, version]);

  const rootPkgName = libraryName.includes("/") ? libraryName.split("/")[1]! : libraryName;
  const segments = className.split(".");
  const hasRootPrefix = segments[0] === rootPkgName;
  const classSegments = hasRootPrefix ? segments.slice(1) : segments;
  const prefix = hasRootPrefix ? `${rootPkgName}.` : "";

  return (
    <>
      <HeaderBar>
        <Box mb={3} display="flex" alignItems="center" flexWrap="wrap" gap="8px">
          {treeCollapsed && onToggleTreeCollapse && (
            <IconButton
              icon={SidebarExpandIcon}
              size="small"
              variant="invisible"
              onClick={onToggleTreeCollapse}
              aria-label="Browse symbols"
              title="Browse symbols"
              style={{ color: "var(--color-accent-cyan, #06b6d4)" }}
            />
          )}
          <Breadcrumbs
            items={[
              { label: "Packages", href: "/packages" },
              { label: libraryName, href: `/packages/${libraryName}` },
              { label: `v${version}`, href: `/packages/${libraryName}/${version}` },
              ...classSegments.map((segment, i, parts) => {
                const fullName = prefix + parts.slice(0, i + 1).join(".");
                const isLast = i === parts.length - 1;
                return {
                  label: segment,
                  href: isLast ? undefined : `/packages/${libraryName}/${version}/classes/${fullName}`,
                };
              }),
            ]}
          />
        </Box>

        <HeroRow>
          <HeroLeft>
            <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
              <Heading as="h1" style={{ color: "var(--color-text-heading)", fontWeight: 700, fontSize: 26, margin: 0 }}>
                {className}
              </Heading>
              <Label
                variant="accent"
                style={{
                  fontSize: 12,
                  padding: "2px 8px",
                  background: "var(--color-accent-blue-bg)",
                  color: "var(--color-accent-blue)",
                  border: "1px solid var(--color-accent-blue-border)",
                }}
              >
                {cls.classKind}
              </Label>
              {cls.sourceFile && (
                <Label
                  variant="secondary"
                  style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)", opacity: 0.85 }}
                >
                  {cls.sourceFile}
                </Label>
              )}
              {jobStatus && jobStatus !== "completed" && (
                <Label
                  variant={jobStatus === "failed" ? "danger" : "attention"}
                  style={{ cursor: onOpenLogs ? "pointer" : "default" }}
                  onClick={onOpenLogs}
                  title={onOpenLogs ? "Click to view logs" : undefined}
                >
                  {jobStatus === "failed" ? "Ingestion Failed" : jobStatus === "processing" ? "Processing…" : "Pending"}
                </Label>
              )}
            </Box>

            {cls.extends && cls.extends.length > 0 && (
              <Box display="flex" alignItems="center" gap="6px" flexWrap="wrap">
                <Text style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600 }}>Extends:</Text>
                {cls.extends.map((base) => {
                  const targetUrl = resolveTypeTargetUrl(base, libraryName, version, allClasses, className);
                  return targetUrl ? (
                    <Link key={base} to={targetUrl} style={{ textDecoration: "none" }}>
                      <Label
                        variant="secondary"
                        style={{
                          fontSize: 11,
                          cursor: "pointer",
                          borderColor: "var(--ms-brand, var(--color-accent-cyan, #06b6d4))",
                          color: "var(--ms-brand, var(--color-accent-cyan, #06b6d4))",
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
            )}

            {cls.description && (
              <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14.5, margin: "2px 0 0" }}>
                {cls.description}
              </Text>
            )}

            <div
              style={{
                marginTop: 6,
                padding: "8px 12px",
                borderRadius: 8,
                background: "var(--ms-surface-hover, var(--color-glass-bg))",
                border: "1px solid var(--ms-border, var(--color-border))",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 12,
                color: "var(--color-text-primary)",
                overflowX: "auto",
              }}
            >
              {signature}
            </div>
          </HeroLeft>

          <HeroIconCard title={`${className} (${cls.classKind})`}>
            {!imgError ? (
              <img
                src={getIconUrl(libraryName, version, className)}
                alt={`${className} icon`}
                onError={() => setImgError(true)}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            ) : (
              <Box
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                style={{ color: "var(--color-text-muted)" }}
              >
                <PackageIcon size={26} />
                <span
                  style={{
                    fontSize: "9px",
                    fontFamily: "var(--font-mono, monospace)",
                    textTransform: "uppercase",
                    marginTop: "2px",
                  }}
                >
                  {cls.classKind}
                </span>
              </Box>
            )}
          </HeroIconCard>
        </HeroRow>
      </HeaderBar>

      {/* ── Javadoc Navigation Tabs ── */}
      <TabBar role="tablist" aria-label="Class Documentation Sections">
        <TabButton
          role="tab"
          aria-selected={activeTab === "overview"}
          $active={activeTab === "overview"}
          onClick={() => setActiveTab("overview")}
        >
          <BookIcon size={15} />
          Overview
        </TabButton>
        <TabButton
          role="tab"
          aria-selected={activeTab === "parameters"}
          $active={activeTab === "parameters"}
          onClick={() => setActiveTab("parameters")}
        >
          <SlidersIcon size={15} />
          Parameters &amp; Ports
          <TabCountBadge $active={activeTab === "parameters"}>{cls.components.length}</TabCountBadge>
        </TabButton>
        {(equationsCount > 0 || (!cls.classKind.startsWith("sysml") && !cls.classKind.startsWith("cad"))) && (
          <TabButton
            role="tab"
            aria-selected={activeTab === "equations"}
            $active={activeTab === "equations"}
            onClick={() => setActiveTab("equations")}
          >
            <WorkflowIcon size={15} />
            Equations
            <TabCountBadge $active={activeTab === "equations"}>{equationsCount}</TabCountBadge>
          </TabButton>
        )}
        {showStudies && (
          <TabButton
            role="tab"
            aria-selected={activeTab === "studies"}
            $active={activeTab === "studies"}
            onClick={() => setActiveTab("studies")}
          >
            <BeakerIcon size={15} />
            Studies &amp; Jobs
            {studiesCount > 0 && <TabCountBadge $active={activeTab === "studies"}>{studiesCount}</TabCountBadge>}
          </TabButton>
        )}
        {cls.sourceCode && (
          <TabButton
            role="tab"
            aria-selected={activeTab === "source"}
            $active={activeTab === "source"}
            onClick={() => setActiveTab("source")}
          >
            <FileCodeIcon size={15} />
            Source
          </TabButton>
        )}
      </TabBar>
    </>
  );
};
