// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookIcon, FileCodeIcon, SlidersIcon, WorkflowIcon } from "@primer/octicons-react";
import { Heading, Label, Text } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import Breadcrumbs from "../../../components/Breadcrumbs";
import { HeaderBar, TabBar, TabButton, TabCountBadge } from "../styles";
import type { ClassDetail, ClassTabId, JobStatus } from "../types";

export interface ClassDetailHeaderProps {
  libraryName: string;
  version: string;
  className: string;
  cls: ClassDetail;
  jobStatus: JobStatus | null;
  activeTab: ClassTabId;
  setActiveTab: (tab: ClassTabId) => void;
  equationsCount: number;
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
}) => {
  return (
    <HeaderBar>
      <Box mb={3}>
        <Breadcrumbs
          items={[
            { label: "Libraries", href: "/packages" },
            { label: libraryName, href: `/packages/${libraryName}` },
            { label: version, href: `/packages/${libraryName}/${version}` },
            ...className.split(".").map((segment, i, parts) => {
              const fullName = parts.slice(0, i + 1).join(".");
              const isLast = i === parts.length - 1;
              return {
                label: segment,
                href: isLast ? undefined : `/packages/${libraryName}/${version}/classes/${fullName}`,
              };
            }),
          ]}
        />
      </Box>
      <Box display="flex" alignItems="center" justifyContent="space-between" gap="16px" flexWrap="wrap">
        <Box>
          <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
            <Heading as="h1" style={{ color: "var(--color-text-heading)", fontWeight: 700, fontSize: 28, margin: 0 }}>
              {className}
            </Heading>
            <Label
              variant="accent"
              style={{
                fontSize: 13,
                padding: "2px 10px",
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
              <Label variant="attention">{jobStatus === "processing" ? "Processing…" : "Pending"}</Label>
            )}
          </Box>
          {cls.description && (
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 15, margin: "6px 0 0" }}>
              {cls.description}
            </Text>
          )}
        </Box>
      </Box>

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
    </HeaderBar>
  );
};
