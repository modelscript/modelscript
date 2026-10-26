// SPDX-License-Identifier: AGPL-3.0-or-later

import { PackageIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import { Text, TextInput } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import { getIconUrl } from "../../../api";
import Box from "../../../components/Box";
import { ClassTreeNode } from "../../../components/ClassTree";
import type { ClassDomain, ClassTreeNode as ClassTreeNodeType } from "../../../components/classTreeUtils";
import InvertedSvg from "../../../components/InvertedSvg";
import { Divider, DomainFilterPill, DomainPillBar, TreeScrollArea, TreeSidebar } from "../styles";

export interface ClassTreeSidebarProps {
  libraryName: string;
  version: string;
  activeClassName?: string | undefined;
  treeSearch: string;
  setTreeSearch: (q: string) => void;
  domainFilter: "all" | ClassDomain;
  setDomainFilter: (d: "all" | ClassDomain) => void;
  domainCounts: { all: number; modelica: number; sysml2: number; cad: number };
  filteredTree: ClassTreeNodeType[];
  hasMultipleDomains: boolean;
}

export const ClassTreeSidebar: React.FC<ClassTreeSidebarProps> = ({
  libraryName,
  version,
  activeClassName,
  treeSearch,
  setTreeSearch,
  domainFilter,
  setDomainFilter,
  domainCounts,
  filteredTree,
  hasMultipleDomains,
}) => {
  return (
    <TreeSidebar>
      <Box
        style={{
          height: "68px",
          minHeight: "68px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "0 16px",
          boxSizing: "border-box",
        }}
      >
        <InvertedSvg
          src={getIconUrl(libraryName, version, libraryName)}
          alt=""
          width={28}
          height={28}
          fallback={<PackageIcon size={24} />}
          style={{ flexShrink: 0 }}
        />
        <Box display="flex" flexDirection="column" style={{ minWidth: 0 }}>
          <Link
            to={`/packages/${libraryName}/${version}`}
            style={{
              fontWeight: 600,
              fontSize: 14,
              color: "var(--color-text-primary)",
              lineHeight: 1.2,
              textDecoration: "none",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {libraryName}
          </Link>
          <Text style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: "2px" }}>v{version}</Text>
        </Box>
      </Box>

      {/* Search input for filtering class hierarchy */}
      <Box px={2} pb={2}>
        <TextInput
          leadingVisual={SearchIcon}
          trailingAction={
            treeSearch ? (
              <TextInput.Action onClick={() => setTreeSearch("")} icon={XIcon} aria-label="Clear symbol filter" />
            ) : undefined
          }
          placeholder="Filter symbols…"
          value={treeSearch}
          onChange={(e) => setTreeSearch(e.target.value)}
          size="small"
          block
          style={{
            background: "var(--color-glass-bg)",
            border: "1px solid var(--color-border)",
            fontSize: 12,
          }}
        />
      </Box>

      {/* Domain filter pills when polyglot classes exist */}
      {hasMultipleDomains && (
        <DomainPillBar>
          <DomainFilterPill $active={domainFilter === "all"} onClick={() => setDomainFilter("all")}>
            All ({domainCounts.all})
          </DomainFilterPill>
          {domainCounts.modelica > 0 && (
            <DomainFilterPill $active={domainFilter === "modelica"} onClick={() => setDomainFilter("modelica")}>
              Modelica ({domainCounts.modelica})
            </DomainFilterPill>
          )}
          {domainCounts.sysml2 > 0 && (
            <DomainFilterPill $active={domainFilter === "sysml2"} onClick={() => setDomainFilter("sysml2")}>
              SysML ({domainCounts.sysml2})
            </DomainFilterPill>
          )}
          {domainCounts.cad > 0 && (
            <DomainFilterPill $active={domainFilter === "cad"} onClick={() => setDomainFilter("cad")}>
              CAD ({domainCounts.cad})
            </DomainFilterPill>
          )}
        </DomainPillBar>
      )}

      <TreeScrollArea>
        <Divider style={{ marginTop: 0, marginBottom: 8 }} />
        {filteredTree.length > 0 ? (
          filteredTree.map((node) => (
            <ClassTreeNode
              key={node.fullName}
              node={node}
              depth={0}
              libraryName={libraryName}
              version={version}
              activeClassName={activeClassName}
              isFiltered={Boolean(treeSearch.trim())}
            />
          ))
        ) : (
          <Box p={3} style={{ textAlign: "center" }}>
            <Text style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              No matching classes for "{treeSearch}"
            </Text>
          </Box>
        )}
      </TreeScrollArea>
    </TreeSidebar>
  );
};
