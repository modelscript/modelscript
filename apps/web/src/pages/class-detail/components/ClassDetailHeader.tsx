// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BeakerIcon,
  BookIcon,
  FileCodeIcon,
  PackageIcon,
  PulseIcon,
  SidebarExpandIcon,
  SlidersIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { Heading, IconButton, Label } from "@primer/react";
import React from "react";
import styledImport from "styled-components";
import { getIconUrl, type ClassSummary } from "../../../api";
import Box from "../../../components/Box";
import Breadcrumbs from "../../../components/Breadcrumbs";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import { HeaderBar, TabBar, TabButton, TabCountBadge } from "../styles";
import type { ClassDetail, ClassTabId, JobStatus } from "../types";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

const HeroRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 20px;
  width: 100%;

  @media (max-width: 640px) {
    flex-direction: column;
    gap: 14px;
  }
`;

const HeroLeft = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
`;

const FqnText = styled.div`
  font-size: 12px;
  line-height: 1.35;
  color: var(--color-text-muted);
  font-family: var(--font-mono, monospace);
  word-break: break-all;
  margin-bottom: 4px;
  letter-spacing: -0.1px;
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
`;

const FilePathBadge = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  color: var(--color-text-muted);
  background: var(--ms-surface-hover, var(--color-canvas-subtle, rgba(255, 255, 255, 0.04)));
  border: 1px solid var(--ms-border, var(--color-border));
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.4;
  width: fit-content;
  margin-bottom: 8px;

  &:hover {
    color: var(--ms-brand, var(--color-accent-cyan, #06b6d4));
    border-color: var(--ms-brand, var(--color-accent-cyan, #06b6d4));
    background: var(--ms-brand-soft, rgba(6, 182, 212, 0.08));
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-cyan, #06b6d4);
    outline-offset: 1px;
  }
`;

const DescriptionText = styled.p`
  color: var(--color-text-muted);
  font-size: 14px;
  line-height: 1.55;
  margin: 0;
  max-width: 900px;
`;

const HeroIconCard = styled.div`
  width: 100px;
  height: 100px;
  border-radius: 18px;
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
  padding: 10px;
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
    width: 64px;
    height: 64px;
    border-radius: 12px;
    padding: 8px;
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
  isSimulatable?: boolean | undefined;
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
  isSimulatable = false,
  studiesCount = 0,
  hasCae,
  treeCollapsed,
  onToggleTreeCollapse,
  onOpenLogs,
  allClasses: _allClasses = [],
}) => {
  const flagCae = useFeatureFlag("cae_cloud_solver");
  const showStudies = hasCae ?? flagCae;

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
                <PackageIcon size={36} />
                <span
                  style={{
                    fontSize: "10px",
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

          <HeroLeft>
            <FqnText>{className}</FqnText>

            <TitleRow>
              <Heading
                as="h1"
                style={{
                  color: "var(--color-text-heading)",
                  fontWeight: 700,
                  fontSize: 24,
                  lineHeight: 1.25,
                  margin: 0,
                }}
              >
                {className.includes(".") ? className.split(".").pop() : className}
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
            </TitleRow>

            {cls.sourceFile && (
              <FilePathBadge
                type="button"
                onClick={() => setActiveTab("source")}
                title="View in Source tab"
                aria-label={`Open source file ${cls.sourceFile}`}
              >
                <FileCodeIcon size={12} style={{ opacity: 0.85 }} />
                <span>{cls.sourceFile}</span>
              </FilePathBadge>
            )}

            {cls.description && <DescriptionText>{cls.description}</DescriptionText>}
          </HeroLeft>
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
          <TabCountBadge $active={activeTab === "parameters"}>
            {cls.components.length + (cls.extends?.length || 0)}
          </TabCountBadge>
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
        {isSimulatable && (
          <TabButton
            role="tab"
            aria-selected={activeTab === "simulation"}
            $active={activeTab === "simulation"}
            onClick={() => setActiveTab("simulation")}
          >
            <PulseIcon size={15} />
            Simulation
            <TabCountBadge $active={activeTab === "simulation"}>WASM ⚡</TabCountBadge>
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
