// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
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
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { getIconUrl, type ArtifactViewerInfo } from "../../../api";
import Box from "../../../components/Box";
import type { TreeNode } from "../../../components/classTreeUtils";
import InvertedSvg from "../../../components/InvertedSvg";
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

const TreeItem = styled(Link)<{ $depth: number }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 6px ${(p) => 10 + p.$depth * 16}px;
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--color-text-primary);
  text-decoration: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    background: var(--color-glass-bg-hover);
    color: var(--color-accent-cyan);
    box-shadow: 0 0 10px rgba(6, 182, 212, 0.15);
  }
`;

const TreeToggle = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0;
  display: flex;
  align-items: center;
  &:hover {
    color: var(--color-text-primary);
  }
`;

const ClassTreeNode: React.FC<{
  node: TreeNode;
  depth: number;
  libraryName: string;
  version: string;
  isFiltered?: boolean | undefined;
}> = ({ node, depth, libraryName, version, isFiltered }) => {
  const [expanded, setExpanded] = useState(depth < 1 || Boolean(isFiltered));

  useEffect(() => {
    if (isFiltered) {
      setExpanded(true);
    }
  }, [isFiltered]);

  const hasChildren = node.children.length > 0;
  const iconUrl = getIconUrl(libraryName, version, node.fullName);

  return (
    <>
      <TreeItem
        to={`/packages/${libraryName}/${version}/classes/${node.fullName}`}
        $depth={depth}
        onClick={() => {
          if (hasChildren && !expanded) {
            setExpanded(true);
          }
        }}
      >
        {hasChildren ? (
          <TreeToggle
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
          </TreeToggle>
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}
        <InvertedSvg
          src={iconUrl}
          alt=""
          width={16}
          height={16}
          fallback={
            node.classKind.includes("sysml") ? (
              <CodeIcon size={16} fill="var(--color-primary)" />
            ) : node.classKind.includes("cad") ||
              node.classKind.includes("product") ||
              node.classKind.includes("shape") ? (
              <CpuIcon size={16} fill="var(--color-warning)" />
            ) : (
              <PackageIcon size={16} fill="var(--color-text-muted)" />
            )
          }
        />
        <span>{node.name}</span>
        <Label
          variant="secondary"
          style={{ fontSize: "10px", padding: "0 4px", lineHeight: "16px", marginLeft: "auto" }}
        >
          {node.classKind}
        </Label>
      </TreeItem>
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <ClassTreeNode
            key={child.fullName}
            node={child}
            depth={depth + 1}
            libraryName={libraryName}
            version={version}
            isFiltered={isFiltered}
          />
        ))}
    </>
  );
};

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
}

export const PackageTreeSidebar: React.FC<PackageTreeSidebarProps> = ({
  name,
  version,
  rootClassName,
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
}) => {
  return (
    <>
      <MobileTreeToggle type="button" onClick={() => setMobileTreeOpen((prev) => !prev)}>
        <span>
          Browse Components &amp; Artifacts (
          {filteredTree.length +
            filteredSysml.length +
            filteredCad.length +
            filteredDatasets.length +
            filteredFmu.length +
            filteredOther.length}
          )
        </span>
        {mobileTreeOpen ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
      </MobileTreeToggle>

      <TreeSidebar $mobileOpen={mobileTreeOpen}>
        <Box
          style={{
            height: "72px",
            minHeight: "72px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "0 16px",
            boxSizing: "border-box",
          }}
        >
          <InvertedSvg
            src={getIconUrl(name, version, rootClassName || name)}
            alt=""
            width={32}
            height={32}
            style={{ flexShrink: 0 }}
          />
          <Box display="flex" flexDirection="column" style={{ minWidth: 0 }}>
            <Box display="flex" alignItems="center" gap={1}>
              <Text
                style={{
                  fontWeight: 600,
                  fontSize: 14,
                  color: "var(--color-text-primary)",
                  lineHeight: 1.2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </Text>
              {availableDomains.length > 2 && (
                <Label variant="accent" style={{ fontSize: 9, padding: "0 4px", lineHeight: "14px" }}>
                  Polyglot
                </Label>
              )}
            </Box>
            <Text style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: "2px" }}>v{version}</Text>
          </Box>
        </Box>

        {/* Polyglot Domain Navigation Pills */}
        {availableDomains.length > 2 && (
          <DomainNavWrap>
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
        <Box style={{ padding: "0 12px 10px 12px" }}>
          <TextInput
            leadingVisual={SearchIcon}
            placeholder={
              selectedDomain === "modelica"
                ? "Filter classes..."
                : selectedDomain === "cad"
                  ? "Filter CAD parts..."
                  : selectedDomain === "sysml2"
                    ? "Filter SysML definitions..."
                    : selectedDomain === "dataset"
                      ? "Filter datasets..."
                      : "Filter polyglot symbols..."
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
                  <span>{filteredTree.length}</span>
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
