// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CpuIcon,
  DatabaseIcon,
  FileCodeIcon,
  FileIcon,
  PackageIcon,
  SearchIcon,
  WorkflowIcon,
  XIcon,
} from "@primer/octicons-react";
import { Button, Label, Text, TextInput } from "@primer/react";
import React from "react";
import type { ArtifactViewerInfo } from "../../../api";
import Box from "../../../components/Box";
import { ClassTreeNode } from "../../../components/ClassTree";
import type { TreeNode } from "../../../components/classTreeUtils";
import {
  ArtifactSidebarItem,
  DomainNavWrap,
  DomainPill,
  DomainSectionHeader,
  getArtifactIcon,
  MobileTreeToggle,
  TreeScrollArea,
  TreeSidebar,
  type PolyglotDomain,
} from "../types";

export interface PackageTreeSidebarProps {
  name: string;
  version: string;
  rootClassName?: string | undefined;
  mobileTreeOpen: boolean;
  setMobileTreeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  availableDomains: {
    id: string;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
    count: number;
    color: string;
  }[];
  selectedDomain: PolyglotDomain;
  setSelectedDomain: (domain: PolyglotDomain) => void;
  treeSearchFilter: string;
  setTreeSearchFilter: (query: string) => void;
  filteredTree: TreeNode[];
  filteredSysml: ArtifactViewerInfo[];
  filteredCad: ArtifactViewerInfo[];
  filteredDatasets: ArtifactViewerInfo[];
  filteredFmu: ArtifactViewerInfo[];
  filteredOther: ArtifactViewerInfo[];
  onOpenArtifact: (av: ArtifactViewerInfo) => void;
  collapsed?: boolean | undefined;
  onToggleCollapse?: (() => void) | undefined;
  totalClassesCount?: number | undefined;
}

function countTreeNodes(nodes: TreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1 + countTreeNodes(node.children);
  }
  return count;
}

export const PackageTreeSidebar: React.FC<PackageTreeSidebarProps> = ({
  name,
  version,
  mobileTreeOpen,
  setMobileTreeOpen,
  availableDomains,
  selectedDomain,
  setSelectedDomain,
  treeSearchFilter,
  setTreeSearchFilter,
  filteredTree,
  filteredSysml,
  filteredCad,
  filteredDatasets,
  filteredFmu,
  filteredOther,
  onOpenArtifact,
  collapsed,
  onToggleCollapse,
  totalClassesCount,
}) => {
  const totalClassCount = countTreeNodes(filteredTree);
  const displayClassCount = !treeSearchFilter.trim() && totalClassesCount ? totalClassesCount : totalClassCount;
  const modelingDomainsCount = availableDomains.filter((d) =>
    ["modelica", "sysml2", "cad", "fmu"].includes(d.id),
  ).length;
  const isMultiDomain = availableDomains.length > 2 && modelingDomainsCount > 1;

  return (
    <>
      <MobileTreeToggle type="button" onClick={() => setMobileTreeOpen((prev) => !prev)}>
        <span>
          Browse Symbols &amp; Components (
          {(
            displayClassCount +
            filteredSysml.length +
            filteredCad.length +
            filteredDatasets.length +
            filteredFmu.length +
            filteredOther.length
          ).toLocaleString()}
          )
        </span>
        {mobileTreeOpen ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
      </MobileTreeToggle>

      <TreeSidebar $mobileOpen={mobileTreeOpen} $collapsed={collapsed}>
        <Box
          style={{
            height: "52px",
            minHeight: "52px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            padding: "0 12px 0 14px",
            boxSizing: "border-box",
            borderBottom: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.06))",
          }}
        >
          <Box display="flex" alignItems="center" gap="8px" style={{ minWidth: 0, flex: 1 }}>
            <FileCodeIcon size={15} fill="var(--color-text-muted)" />
            <Text
              style={{
                fontWeight: 600,
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--color-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Symbol Explorer
            </Text>
            <Label variant="secondary" style={{ fontSize: 10, padding: "0 6px", lineHeight: "16px" }}>
              {displayClassCount.toLocaleString()}
            </Label>
            {isMultiDomain && (
              <Label variant="accent" style={{ fontSize: 9, padding: "0 4px", lineHeight: "14px" }}>
                Polyglot
              </Label>
            )}
          </Box>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title="Collapse symbol tree"
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-muted)",
                padding: "6px",
                borderRadius: "6px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--color-text-primary)";
                e.currentTarget.style.background = "var(--color-glass-bg-hover, rgba(255,255,255,0.08))";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--color-text-muted)";
                e.currentTarget.style.background = "none";
              }}
            >
              <ChevronLeftIcon size={16} />
            </button>
          )}
        </Box>

        {/* Polyglot Domain Navigation Pills */}
        {availableDomains.length > 2 && (
          <DomainNavWrap style={{ paddingTop: 10 }}>
            {availableDomains.map((d) => {
              const IconComp = d.icon;
              return (
                <DomainPill
                  key={d.id}
                  $active={selectedDomain === d.id}
                  $color={d.color}
                  onClick={() => setSelectedDomain(d.id as PolyglotDomain)}
                  title={`${d.label} (${d.count})`}
                >
                  <IconComp size={12} />
                  <span>{d.label}</span>
                  <span className="domain-count">{d.count}</span>
                </DomainPill>
              );
            })}
          </DomainNavWrap>
        )}

        {/* Search Input */}
        <Box style={{ padding: availableDomains.length > 2 ? "0 12px 10px 12px" : "10px 12px" }}>
          <TextInput
            leadingVisual={SearchIcon}
            placeholder={
              selectedDomain === "modelica" || availableDomains.length <= 2
                ? "Filter classes & symbols..."
                : selectedDomain === "cad"
                  ? "Filter CAD parts..."
                  : selectedDomain === "sysml2"
                    ? "Filter SysML definitions..."
                    : selectedDomain === "dataset"
                      ? "Filter datasets..."
                      : "Filter symbols..."
            }
            value={treeSearchFilter}
            onChange={(e) => setTreeSearchFilter(e.target.value)}
            size="small"
            block
            trailingAction={
              treeSearchFilter ? (
                <TextInput.Action onClick={() => setTreeSearchFilter("")} icon={XIcon} aria-label="Clear filter" />
              ) : undefined
            }
          />
        </Box>

        <TreeScrollArea>
          {/* Modelica Section */}
          {(selectedDomain === "all" || selectedDomain === "modelica") && filteredTree.length > 0 && (
            <>
              {selectedDomain === "all" && availableDomains.length > 2 && (
                <DomainSectionHeader>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <FileCodeIcon size={13} /> Modelica Classes
                  </span>
                  <span>{displayClassCount.toLocaleString()}</span>
                </DomainSectionHeader>
              )}
              {filteredTree.map((node) => (
                <ClassTreeNode
                  key={node.fullName}
                  node={node}
                  depth={0}
                  libraryName={name}
                  version={version}
                  isFiltered={Boolean(treeSearchFilter.trim())}
                />
              ))}
            </>
          )}

          {/* SysML v2 Section */}
          {(selectedDomain === "all" || selectedDomain === "sysml2") && filteredSysml.length > 0 && (
            <>
              {selectedDomain === "all" && availableDomains.length > 2 && (
                <DomainSectionHeader>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <WorkflowIcon size={13} /> SysML v2 Architecture
                  </span>
                  <span>{filteredSysml.length}</span>
                </DomainSectionHeader>
              )}
              {filteredSysml.map((av) => (
                <ArtifactSidebarItem key={av.id} onClick={() => onOpenArtifact(av)}>
                  {getArtifactIcon(av.type, av.path)}
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                    }}
                    title={av.path}
                  >
                    {av.displayName || av.path}
                  </span>
                  <Label variant="secondary" style={{ fontSize: "10px", padding: "0 4px", lineHeight: "14px" }}>
                    SysML
                  </Label>
                </ArtifactSidebarItem>
              ))}
            </>
          )}

          {/* 3D CAD Section */}
          {(selectedDomain === "all" || selectedDomain === "cad") && filteredCad.length > 0 && (
            <>
              {selectedDomain === "all" && availableDomains.length > 2 && (
                <DomainSectionHeader>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <PackageIcon size={13} /> 3D CAD Models
                  </span>
                  <span>{filteredCad.length}</span>
                </DomainSectionHeader>
              )}
              {filteredCad.map((av) => (
                <ArtifactSidebarItem key={av.id} onClick={() => onOpenArtifact(av)}>
                  {getArtifactIcon(av.type, av.path)}
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                    }}
                    title={av.path}
                  >
                    {av.displayName || av.path}
                  </span>
                  <Label
                    variant="secondary"
                    style={{
                      fontSize: "10px",
                      padding: "0 4px",
                      lineHeight: "14px",
                      color: "var(--color-accent-cyan, #06b6d4)",
                    }}
                  >
                    STEP
                  </Label>
                </ArtifactSidebarItem>
              ))}
            </>
          )}

          {/* Datasets Section */}
          {(selectedDomain === "all" || selectedDomain === "dataset") && filteredDatasets.length > 0 && (
            <>
              {selectedDomain === "all" && availableDomains.length > 2 && (
                <DomainSectionHeader>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <DatabaseIcon size={13} /> Datasets &amp; Tables
                  </span>
                  <span>{filteredDatasets.length}</span>
                </DomainSectionHeader>
              )}
              {filteredDatasets.map((av) => (
                <ArtifactSidebarItem key={av.id} onClick={() => onOpenArtifact(av)}>
                  {getArtifactIcon(av.type, av.path)}
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                    }}
                    title={av.path}
                  >
                    {av.displayName || av.path}
                  </span>
                  <Label variant="secondary" style={{ fontSize: "10px", padding: "0 4px", lineHeight: "14px" }}>
                    CSV
                  </Label>
                </ArtifactSidebarItem>
              ))}
            </>
          )}

          {/* FMUs Section */}
          {(selectedDomain === "all" || selectedDomain === "fmu") && filteredFmu.length > 0 && (
            <>
              {selectedDomain === "all" && availableDomains.length > 2 && (
                <DomainSectionHeader>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <CpuIcon size={13} /> FMU Simulators
                  </span>
                  <span>{filteredFmu.length}</span>
                </DomainSectionHeader>
              )}
              {filteredFmu.map((av) => (
                <ArtifactSidebarItem key={av.id} onClick={() => onOpenArtifact(av)}>
                  {getArtifactIcon(av.type, av.path)}
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                    }}
                    title={av.path}
                  >
                    {av.displayName || av.path}
                  </span>
                  <Label
                    variant="secondary"
                    style={{ fontSize: "10px", padding: "0 4px", lineHeight: "14px", color: "#f43f5e" }}
                  >
                    FMU
                  </Label>
                </ArtifactSidebarItem>
              ))}
            </>
          )}

          {/* Other Files Section */}
          {(selectedDomain === "all" || selectedDomain === "other") && filteredOther.length > 0 && (
            <>
              {selectedDomain === "all" && availableDomains.length > 2 && (
                <DomainSectionHeader>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <FileIcon size={13} /> Other Files
                  </span>
                  <span>{filteredOther.length}</span>
                </DomainSectionHeader>
              )}
              {filteredOther.map((av) => (
                <ArtifactSidebarItem key={av.id} onClick={() => onOpenArtifact(av)}>
                  {getArtifactIcon(av.type, av.path)}
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                    }}
                    title={av.path}
                  >
                    {av.displayName || av.path}
                  </span>
                  <Label variant="secondary" style={{ fontSize: "10px", padding: "0 4px", lineHeight: "14px" }}>
                    {av.type}
                  </Label>
                </ArtifactSidebarItem>
              ))}
            </>
          )}

          {/* Empty State */}
          {filteredTree.length === 0 &&
            filteredSysml.length === 0 &&
            filteredCad.length === 0 &&
            filteredDatasets.length === 0 &&
            filteredFmu.length === 0 &&
            filteredOther.length === 0 && (
              <Box
                style={{ padding: "24px 12px", textAlign: "center", color: "var(--color-text-muted)", fontSize: 12 }}
              >
                <Text as="p" style={{ margin: "0 0 8px 0" }}>
                  No matching items in {selectedDomain === "all" ? "package" : selectedDomain}
                </Text>
                {treeSearchFilter && (
                  <Button size="small" variant="invisible" onClick={() => setTreeSearchFilter("")}>
                    Clear filter
                  </Button>
                )}
              </Box>
            )}
        </TreeScrollArea>
      </TreeSidebar>
    </>
  );
};
