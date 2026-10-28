// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronDownIcon, ChevronUpIcon, CpuIcon, PackageIcon, SyncIcon } from "@primer/octicons-react";
import { Button, Label, Text } from "@primer/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getDiagramUrl,
  getIconUrl,
  rewriteModelicaUris,
  type ClassDetail,
  type ClassSummary,
  type NpmPackument,
} from "../../../api";
import Box from "../../../components/Box";
import { buildClassTree } from "../../../components/classTreeUtils";
import InvertedSvg from "../../../components/InvertedSvg";
import { DiagramWrap, DocCard, GlassCard } from "../types";

export interface PackageReadmeTabProps {
  name: string;
  version: string;
  rootClassName?: string | undefined;
  rootClass?: ClassDetail | null | undefined;
  packument?: NpmPackument | null | undefined;
  classes?: ClassSummary[] | undefined;
  availableDomains: { id: string; label: string; count: number }[];
  onNavigateToDigitalThread: () => void;
  jobStatus?: string | undefined;
}

export const PackageReadmeTab: React.FC<PackageReadmeTabProps> = ({
  name,
  version,
  rootClassName,
  rootClass,
  packument,
  classes = [],
  availableDomains,
  onNavigateToDigitalThread,
  jobStatus,
}) => {
  const [diagramError, setDiagramError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [showDiagram, setShowDiagram] = useState(false);

  const topModules = useMemo(() => {
    if (!classes || classes.length === 0) return [];
    const tree = buildClassTree(classes, rootClassName || name);
    return tree.slice(0, 36);
  }, [classes, rootClassName, name]);

  return (
    <>
      {/* Cyber-Physical Digital Thread Banner */}
      {availableDomains.length > 2 && (
        <GlassCard
          style={{
            padding: "14px 18px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(135deg, rgba(6, 182, 212, 0.08), rgba(168, 85, 247, 0.08))",
            border: "1px solid rgba(6, 182, 212, 0.3)",
            borderRadius: 12,
          }}
        >
          <Box display="flex" alignItems="center" gap={3}>
            <SyncIcon size={20} fill="#06b6d4" />
            <div>
              <Text style={{ fontWeight: 600, fontSize: 14, color: "var(--color-text-heading)" }}>
                Cross-Domain Digital Thread Active
              </Text>
              <Text as="p" style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "2px 0 0" }}>
                Multi-language twins bound across Modelica, SysML v2, and STEP CAD with verified unit parity.
              </Text>
            </div>
          </Box>
          <Button size="small" variant="primary" onClick={onNavigateToDigitalThread}>
            Explore Twins
          </Button>
        </GlassCard>
      )}

      {/* Root class diagram - collapsible so README remains hero content */}
      {!diagramError && (
        <GlassCard
          style={{
            padding: "12px 18px",
            marginBottom: 20,
            borderRadius: 12,
            border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))",
            background: "var(--color-bg-card, rgba(15, 23, 42, 0.4))",
          }}
        >
          <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
            <Box display="flex" alignItems="center" gap={2}>
              <CpuIcon size={16} fill="var(--color-accent-cyan, #06b6d4)" />
              <Text style={{ fontWeight: 600, fontSize: 13, color: "var(--color-text-heading)" }}>
                Architecture &amp; Type Specification
              </Text>
              <Text style={{ fontSize: 12, color: "var(--color-text-muted)" }}>({rootClassName || name})</Text>
            </Box>
            <Button
              size="small"
              variant="invisible"
              onClick={() => setShowDiagram((prev) => !prev)}
              leadingVisual={showDiagram ? ChevronUpIcon : ChevronDownIcon}
              style={{ color: "var(--color-text-primary)", fontSize: 12 }}
            >
              {showDiagram ? "Hide Diagram" : "View Diagram"}
            </Button>
          </Box>
          {showDiagram && (
            <Box mt={3} pt={3} style={{ borderTop: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))" }}>
              <DiagramWrap style={{ margin: 0, border: "none", background: "transparent", padding: 0 }}>
                <InvertedSvg
                  src={`${getDiagramUrl(name, version, rootClassName || name)}?t=${retryCount}`}
                  alt={`${name} diagram`}
                  onError={() => {
                    if (jobStatus && jobStatus !== "completed" && jobStatus !== "failed") {
                      setTimeout(() => setRetryCount((p) => p + 1), 3000);
                    } else {
                      setDiagramError(true);
                    }
                  }}
                />
              </DiagramWrap>
            </Box>
          )}
        </GlassCard>
      )}

      <DocCard>
        {rootClass?.documentation ? (
          <div
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(rewriteModelicaUris(rootClass.documentation, version, name)),
            }}
          />
        ) : packument?.readme && !packument.readme.includes("ERROR: No README data found!") ? (
          <div
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(
                rewriteModelicaUris(
                  marked.parse(packument.readme, { breaks: true, gfm: true }) as string,
                  version,
                  name,
                ),
              ),
            }}
          />
        ) : rootClass?.description ? (
          <Text as="p" style={{ color: "var(--color-text-primary)", lineHeight: 1.7, margin: 0 }}>
            {rootClass.description}
          </Text>
        ) : (
          <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
            Select a module or symbol below to inspect its API documentation, diagram, and source code.
          </Text>
        )}
      </DocCard>

      {/* Navigable Javadoc Top-Level Modules & Definitions Summary Grid */}
      {topModules.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Text
              style={{
                fontSize: 13,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--color-text-muted)",
              }}
            >
              Package Modules &amp; Top-Level Definitions ({classes.length} total symbols)
            </Text>
          </Box>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 12,
            }}
          >
            {topModules.map((mod) => (
              <Link
                key={mod.fullName}
                to={`/packages/${name}/${version}/classes/${mod.fullName}`}
                style={{ textDecoration: "none" }}
              >
                <GlassCard
                  style={{
                    padding: "12px 14px",
                    height: "100%",
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    transition: "border-color 0.15s ease, transform 0.15s ease",
                  }}
                >
                  <Box display="flex" alignItems="center" gap="8px">
                    <InvertedSvg
                      src={getIconUrl(name, version, mod.fullName)}
                      fallback={<PackageIcon size={16} />}
                      alt=""
                      width={20}
                      height={20}
                    />
                    <Text
                      style={{
                        fontFamily: "var(--font-mono, monospace)",
                        fontWeight: 600,
                        fontSize: 13,
                        color: "var(--color-link)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {mod.name}
                    </Text>
                    <Label
                      variant="secondary"
                      style={{ fontSize: 10, padding: "0 5px", lineHeight: "16px", marginLeft: "auto" }}
                    >
                      {mod.classKind}
                    </Label>
                  </Box>
                  {mod.description && (
                    <Text
                      as="p"
                      style={{
                        fontSize: 12,
                        color: "var(--color-text-muted)",
                        margin: 0,
                        lineHeight: 1.4,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {mod.description}
                    </Text>
                  )}
                  {mod.children.length > 0 && (
                    <Text style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: "auto" }}>
                      {mod.children.length} nested {mod.children.length === 1 ? "member" : "members"}
                    </Text>
                  )}
                </GlassCard>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
};
