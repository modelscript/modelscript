// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  BookIcon,
  CheckCircleFillIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  CpuIcon,
  FileCodeIcon,
  GearIcon,
  LinkExternalIcon,
  PackageIcon,
  PlugIcon,
  SearchIcon,
  SlidersIcon,
  WorkflowIcon,
  XIcon,
} from "@primer/octicons-react";
import { Button, Heading, Label, NavList, Spinner, Text, TextInput, Truncate } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import styled, { css, keyframes } from "styled-components";
import type { ClassDetail, ClassSummary, JobStatus } from "../api";
import { getClassDetail, getClasses, getDiagramUrl, getIconUrl, getJobStatus, rewriteModelicaUris } from "../api";
import CadStepViewer from "../components/artifacts/CadStepViewer";
import SysmlViewer from "../components/artifacts/SysmlViewer";
import Box from "../components/Box";
import Breadcrumbs from "../components/Breadcrumbs";
import { ClassTreeNode } from "../components/ClassTree";
import {
  buildClassTree,
  categorizeClassComponents,
  type ClassDomain,
  classifyClassDomain,
  type EnrichedComponent,
  filterClassTree,
  resolveTypeTargetUrl,
} from "../components/classTreeUtils";
import InvertedSvg from "../components/InvertedSvg";
import { usePageTitle } from "../util/title";
import { resolvePackageParams } from "../util/url";

/* ─── styled helpers ─── */

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const PageWrap = styled.div`
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  min-height: 100%;
  display: flex;
  flex-direction: row;
  transition:
    background-color 0.3s ease,
    color 0.3s ease;
  flex: 1;
`;

const TreeSidebar = styled.div`
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  height: calc(100vh - var(--dev-header-height, 0px));
  position: sticky;
  top: var(--dev-header-height, 0px);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
`;

const TreeScrollArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 3px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: var(--color-border-strong);
  }
`;

const MainContentWrap = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
`;

const Divider = styled.hr`
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 24px 0;
`;

const ContentGrid = styled.div`
  max-width: none;
  margin: 0 auto;
  padding: 28px 40px 60px;
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 40px;
  width: 100%;
  box-sizing: border-box;
  animation: ${fadeIn} 0.4s ease;

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
  }
`;

const HeaderBar = styled.div`
  max-width: none;
  width: 100%;
  margin: 0 auto;
  padding: 28px 40px 0;
  box-sizing: border-box;
  border-bottom: 1px solid var(--color-border);
`;

const TabBar = styled.div`
  display: flex;
  gap: 4px;
  margin-top: 20px;
  overflow-x: auto;
`;

const TabButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid ${(p) => (p.$active ? "var(--color-accent-cyan, #06b6d4)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  font-size: 13px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;

  &:hover {
    color: var(--color-text-heading);
    background: rgba(255, 255, 255, 0.03);
  }
`;

const TabCountBadge = styled.span<{ $active?: boolean | undefined }>`
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  background: ${(p) => (p.$active ? "rgba(6, 182, 212, 0.18)" : "var(--color-border, rgba(255, 255, 255, 0.08))")};
  color: ${(p) => (p.$active ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-text-muted)")};
`;

const DomainPillBar = styled.div`
  display: flex;
  gap: 4px;
  padding: 0 12px 8px;
  flex-wrap: wrap;
`;

const DomainFilterPill = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$active ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-border)")};
  background: ${(p) => (p.$active ? "rgba(6, 182, 212, 0.12)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-primary);
    border-color: var(--color-accent-cyan, #06b6d4);
  }
`;

const glassCard = css`
  background: var(--color-bg-card, rgba(15, 23, 42, 0.65));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.1));
  border-radius: 14px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    border-color: rgba(139, 92, 246, 0.35);
    box-shadow:
      0 8px 24px -6px rgba(0, 0, 0, 0.5),
      0 0 16px rgba(139, 92, 246, 0.12);
  }
`;

const GlassCard = styled.div`
  ${glassCard}
  padding: 20px;
  margin-bottom: 16px;
`;

const JavadocSection = styled.section`
  margin-bottom: 32px;
`;

const JavadocTableWrap = styled.div`
  ${glassCard}
  overflow-x: auto;
  margin-bottom: 24px;
`;

const JavadocTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th {
    text-align: left;
    padding: 10px 14px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--color-text-muted);
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid var(--color-border);
  }

  td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--color-border);
    vertical-align: top;
    color: var(--color-text-primary);
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr:hover td {
    background: rgba(255, 255, 255, 0.02);
  }
`;

const TypeLink = styled(Link)`
  color: var(--color-accent-cyan, #06b6d4);
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  text-decoration: none;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 4px;

  &:hover {
    text-decoration: underline;
    color: #38bdf8;
  }
`;

const TypeMono = styled.span`
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  color: var(--color-text-muted);
`;

const CodeBlockWrap = styled.div`
  ${glassCard}
  overflow: hidden;
  margin-bottom: 24px;
`;

const CodeBlockHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.02);
`;

const CodeBlockPre = styled.pre`
  margin: 0;
  padding: 16px 20px;
  overflow-x: auto;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--color-text-primary);
  background: transparent;
`;

const DocCard = styled.div`
  padding: 0;
  margin-bottom: 28px;

  h1,
  h2,
  h3,
  h4 {
    color: var(--color-text-heading);
    margin-top: 24px;
    margin-bottom: 12px;
  }
  p {
    line-height: 1.7;
    color: var(--color-text-primary);
    margin-bottom: 16px;
  }
  a {
    color: var(--color-link);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  code {
    background: var(--color-code-bg);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
  }
  pre {
    background: var(--color-pre-bg);
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
  }
  pre code {
    background: transparent;
    padding: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
  }
  th,
  td {
    border: 1px solid var(--color-table-border);
    padding: 8px 12px;
    text-align: left;
  }
  th {
    background: var(--color-table-header-bg);
    color: var(--color-text-heading);
  }
  img {
    max-width: 100%;
  }
`;

const DetailRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
  &:last-child {
    border-bottom: none;
  }
`;

const DetailLabel = styled.span`
  font-size: 13px;
  color: var(--color-text-muted);
  text-transform: capitalize;
`;

const DetailValue = styled.span`
  font-size: 13px;
  color: var(--color-text-heading);
  font-weight: 500;
  text-align: right;
  max-width: 65%;
  word-break: break-word;
`;

const DiagramWrap = styled.div`
  ${glassCard}
  padding: 24px;
  margin-bottom: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 120px;
  overflow: auto;

  > div > svg {
    width: 100%;
    height: auto;
    max-height: 400px;
    max-width: 100%;
  }
`;

const SectionTitle = styled(Heading)`
  font-size: 12px !important;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--color-text-muted) !important;
  margin-bottom: 12px !important;
  font-weight: 600 !important;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ClassIconBox = styled.div`
  width: 100%;
  padding: 40px;
  border-radius: 12px;
  background: var(--gradient-icon-box);
  border: 1px solid var(--color-border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
  overflow: hidden;
  box-sizing: border-box;

  > div[role="img"],
  > div[role="img"] > svg,
  > svg {
    width: 100% !important;
    height: auto !important;
  }
`;

const ComponentIconWrap = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;

  > div[role="img"],
  > div[role="img"] > svg,
  > svg {
    width: 24px !important;
    height: 24px !important;
  }
`;

type ClassTabId = "overview" | "parameters" | "equations" | "source";

/* ─── main page ─── */

const ClassDetailPage: React.FC = () => {
  const rawParams = useParams<{
    scope?: string | undefined;
    name?: string | undefined;
    version?: string | undefined;
    className?: string | undefined;
  }>();
  const { name, version, className } = resolvePackageParams(rawParams);
  const navigate = useNavigate();
  usePageTitle(className && name && version ? `${className} | ${name}@${version}` : "Class Details");
  const [cls, setCls] = useState<ClassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [diagramLoaded, setDiagramLoaded] = useState(false);
  const [diagramError, setDiagramError] = useState(false);
  const [allClasses, setAllClasses] = useState<ClassSummary[]>([]);
  const [treeSearch, setTreeSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<"all" | ClassDomain>("all");
  const [activeTab, setActiveTab] = useState<ClassTabId>("overview");
  const [copiedSource, setCopiedSource] = useState(false);

  // Reset tab & diagram state when navigating between classes
  useEffect(() => {
    setActiveTab("overview");
    setDiagramLoaded(false);
    setDiagramError(false);
  }, [className]);

  // Fetch all classes for the tree
  useEffect(() => {
    if (!name || !version) return;
    getClasses(name, version)
      .then(setAllClasses)
      .catch(() => {});
  }, [name, version]);

  const domainCounts = useMemo(() => {
    const counts = { all: allClasses.length, modelica: 0, sysml2: 0, cad: 0 };
    for (const c of allClasses) {
      counts[classifyClassDomain(c)]++;
    }
    return counts;
  }, [allClasses]);

  const domainFilteredClasses = useMemo(() => {
    if (domainFilter === "all") return allClasses;
    return allClasses.filter((c) => classifyClassDomain(c) === domainFilter);
  }, [allClasses, domainFilter]);

  const tree = useMemo(() => {
    if (!name || domainFilteredClasses.length === 0) return [];
    const rootPkg = name.includes("/") ? name.split("/")[1]! : name;
    return buildClassTree(domainFilteredClasses, rootPkg);
  }, [domainFilteredClasses, name]);

  const filteredTree = useMemo(() => filterClassTree(tree, treeSearch), [tree, treeSearch]);

  const categorized = useMemo(() => {
    if (!cls) return { parameters: [], connectors: [], submodels: [] };
    return categorizeClassComponents(cls.components || []);
  }, [cls]);

  // Extract digital thread twin counterpart references
  const twinInfo = useMemo(() => {
    if (!cls) return null;
    let twinTarget: string | null = null;
    let cadTarget: string | null = null;

    if (cls.description) {
      const tm = cls.description.match(/twin\s*=\s*["']([^"']+)["']/i);
      if (tm) twinTarget = tm[1]!;
      const cm = cls.description.match(/CAD\s*=\s*["']([^"']+)["']/i);
      if (cm) cadTarget = cm[1]!;
    }

    for (const comp of cls.components) {
      for (const mod of comp.modifiers || []) {
        if (mod.modifier_name === "twin" && mod.modifier_value) {
          twinTarget = mod.modifier_value.replace(/['"]/g, "");
        }
        if ((mod.modifier_name === "CAD" || mod.modifier_name === "cad") && mod.modifier_value) {
          cadTarget = mod.modifier_value.replace(/['"]/g, "");
        }
      }
      if (comp.description) {
        const tm = comp.description.match(/twin\s*=\s*["']([^"']+)["']/i);
        if (tm && !twinTarget) twinTarget = tm[1]!;
        const cm = comp.description.match(/CAD\s*=\s*["']([^"']+)["']/i);
        if (cm && !cadTarget) cadTarget = cm[1]!;
      }
    }

    if (!twinTarget && !cadTarget) return null;
    return { twinTarget, cadTarget };
  }, [cls]);

  const fetchClassDetail = useCallback(async () => {
    if (!name || !version || !className) return;
    try {
      const data = await getClassDetail(name, version, className);
      setCls(data);
      setError(null);
    } catch (err) {
      setError("Failed to load class details");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [name, version, className]);

  useEffect(() => {
    setLoading(true);
    fetchClassDetail();
  }, [fetchClassDetail]);

  useEffect(() => {
    if (!name || !version || jobStatus === "completed" || jobStatus === "failed") return;

    const checkStatus = async () => {
      try {
        const status = await getJobStatus(name, version);
        setJobStatus(status.status);
        if (status.status === "completed") {
          fetchClassDetail();
        }
      } catch (err) {
        console.error("Failed to check job status", err);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [name, version, jobStatus, fetchClassDetail]);

  const renderTypeCell = useCallback(
    (typeName: string) => {
      if (!name || !version) return <TypeMono>{typeName}</TypeMono>;
      const targetUrl = resolveTypeTargetUrl(typeName, name, version, allClasses, className);
      if (targetUrl) {
        return (
          <TypeLink to={targetUrl} title={`Navigate to ${typeName}`}>
            {typeName}
            {!targetUrl.includes(`/classes/`) && <LinkExternalIcon size={11} />}
          </TypeLink>
        );
      }
      return <TypeMono>{typeName}</TypeMono>;
    },
    [name, version, allClasses, className],
  );

  const handleCopySource = () => {
    if (!cls?.sourceCode) return;
    navigator.clipboard.writeText(cls.sourceCode);
    setCopiedSource(true);
    setTimeout(() => setCopiedSource(false), 2000);
  };

  if (loading && !cls) {
    return (
      <PageWrap style={{ justifyContent: "center", alignItems: "center" }}>
        <Spinner size="large" />
      </PageWrap>
    );
  }

  if (error || !cls) {
    return (
      <PageWrap style={{ justifyContent: "center", alignItems: "center" }}>
        <Box
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            padding: 40,
            textAlign: "center",
          }}
        >
          <AlertIcon size={48} fill="var(--color-error)" />
          <Heading as="h2" style={{ color: "var(--color-text-heading)", fontSize: 22, margin: 0 }}>
            {error || "Class not found"}
          </Heading>
          <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 15, margin: 0, maxWidth: 400 }}>
            The class may not exist, is still being processed, or the server is unavailable.
          </Text>
        </Box>
      </PageWrap>
    );
  }

  const equations = cls.equations || [];
  const hasMultipleDomains =
    (domainCounts.modelica > 0 ? 1 : 0) + (domainCounts.sysml2 > 0 ? 1 : 0) + (domainCounts.cad > 0 ? 1 : 0) > 1;

  const renderParametersTable = (items: EnrichedComponent[]) => (
    <JavadocSection>
      <SectionTitle as="h3">
        <SlidersIcon size={14} /> Parameters & Constants ({items.length})
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
            {items.map((param) => (
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
  );

  const renderConnectorsTable = (items: EnrichedComponent[]) => (
    <JavadocSection>
      <SectionTitle as="h3">
        <PlugIcon size={14} /> Connectors & Ports ({items.length})
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
            {items.map((conn) => (
              <tr key={conn.component_name}>
                <td>
                  <Box display="flex" alignItems="center" gap="8px">
                    <InvertedSvg
                      src={getIconUrl(name!, version!, conn.type_name)}
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
  );

  const renderSubmodelsTable = (items: EnrichedComponent[]) => (
    <JavadocSection>
      <SectionTitle as="h3">
        <PackageIcon size={14} /> Components & Submodels ({items.length})
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
            {items.map((sub) => {
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
                        src={getIconUrl(name!, version!, sub.type_name)}
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
  );

  return (
    <PageWrap>
      {/* ── Left Sidebar (Classes) ── */}
      {allClasses.length > 0 && (
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
              src={getIconUrl(name!, version!, name!)}
              alt=""
              width={28}
              height={28}
              fallback={<PackageIcon size={24} />}
              style={{ flexShrink: 0 }}
            />
            <Box display="flex" flexDirection="column" style={{ minWidth: 0 }}>
              <Link
                to={`/packages/${name}/${version}`}
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
                {name}
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
                  libraryName={name!}
                  version={version!}
                  activeClassName={className}
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
      )}

      <MainContentWrap>
        {/* ── Header ── */}
        <HeaderBar>
          <Box mb={3}>
            <Breadcrumbs
              items={[
                { label: "Libraries", href: "/packages" },
                { label: name || "", href: `/packages/${name}` },
                { label: version || "", href: `/packages/${name}/${version}` },
                ...(className || "").split(".").map((segment, i, parts) => {
                  const fullName = parts.slice(0, i + 1).join(".");
                  const isLast = i === parts.length - 1;
                  return {
                    label: segment,
                    href: isLast ? undefined : `/packages/${name}/${version}/classes/${fullName}`,
                  };
                }),
              ]}
            />
          </Box>
          <Box display="flex" alignItems="center" justifyContent="space-between" gap="16px" flexWrap="wrap">
            <Box>
              <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
                <Heading
                  as="h1"
                  style={{ color: "var(--color-text-heading)", fontWeight: 700, fontSize: 28, margin: 0 }}
                >
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
              Parameters & Ports
              <TabCountBadge $active={activeTab === "parameters"}>{cls.components.length}</TabCountBadge>
            </TabButton>
            {(equations.length > 0 || (!cls.classKind.startsWith("sysml") && !cls.classKind.startsWith("cad"))) && (
              <TabButton
                role="tab"
                aria-selected={activeTab === "equations"}
                $active={activeTab === "equations"}
                onClick={() => setActiveTab("equations")}
              >
                <WorkflowIcon size={15} />
                Equations
                <TabCountBadge $active={activeTab === "equations"}>{equations.length}</TabCountBadge>
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

        {/* ── Body ── */}
        <ContentGrid>
          {/* ── Main column ── */}
          <div style={{ minWidth: 0 }}>
            {activeTab === "overview" && (
              <>
                {/* Embedded SysML v2 Architecture Viewer for SysML classes */}
                {cls.sysmlConfig && (
                  <JavadocSection>
                    <SectionTitle as="h3">
                      <WorkflowIcon size={14} /> SysML v2 Architecture & Requirements
                    </SectionTitle>
                    <SysmlViewer
                      viewConfig={{
                        title: className,
                        ...cls.sysmlConfig,
                      }}
                    />
                  </JavadocSection>
                )}

                {/* Embedded 3D STEP B-Rep Viewer for CAD classes */}
                {cls.cadResourceUrl && (
                  <JavadocSection>
                    <SectionTitle as="h3">
                      <CpuIcon size={14} /> 3D STEP Solid Geometry
                    </SectionTitle>
                    <CadStepViewer viewConfig={{ url: cls.cadResourceUrl }} />
                  </JavadocSection>
                )}

                {/* Modelica Schematic Diagram */}
                {!diagramError && !cls.sysmlConfig && !cls.cadResourceUrl && (
                  <div style={diagramLoaded ? undefined : { position: "absolute", opacity: 0, pointerEvents: "none" }}>
                    <SectionTitle as="h3">Diagram</SectionTitle>
                    <DiagramWrap>
                      <InvertedSvg
                        src={`${getDiagramUrl(name!, version!, className!)}?t=${retryCount}`}
                        alt={`${className} diagram`}
                        onLoad={() => setDiagramLoaded(true)}
                        onError={() => {
                          if (jobStatus && jobStatus !== "completed" && jobStatus !== "failed") {
                            setTimeout(() => setRetryCount((p) => p + 1), 3000);
                          } else {
                            setDiagramError(true);
                          }
                        }}
                      />
                    </DiagramWrap>
                  </div>
                )}

                {/* Documentation */}
                <JavadocSection>
                  <SectionTitle as="h3">
                    <BookIcon size={14} /> Documentation
                  </SectionTitle>
                  <DocCard>
                    {cls.documentation ? (
                      <div
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(rewriteModelicaUris(cls.documentation, version!, name)),
                        }}
                      />
                    ) : cls.description ? (
                      <Text as="p" style={{ color: "var(--color-text-primary)", lineHeight: 1.7, margin: 0 }}>
                        {cls.description}
                      </Text>
                    ) : (
                      <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
                        No documentation available for this class.
                      </Text>
                    )}
                  </DocCard>
                </JavadocSection>

                {/* Javadoc Summary Tables on Overview */}
                {categorized.parameters.length > 0 && renderParametersTable(categorized.parameters)}
                {categorized.connectors.length > 0 && renderConnectorsTable(categorized.connectors)}
                {categorized.submodels.length > 0 && renderSubmodelsTable(categorized.submodels)}
              </>
            )}

            {activeTab === "parameters" && (
              <>
                {cls.components.length === 0 ? (
                  <GlassCard>
                    <Text style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
                      No parameters, ports, or subcomponents declared on this class.
                    </Text>
                  </GlassCard>
                ) : (
                  <>
                    {categorized.parameters.length > 0 && renderParametersTable(categorized.parameters)}
                    {categorized.connectors.length > 0 && renderConnectorsTable(categorized.connectors)}
                    {categorized.submodels.length > 0 && renderSubmodelsTable(categorized.submodels)}
                  </>
                )}
              </>
            )}

            {activeTab === "equations" && (
              <JavadocSection>
                <SectionTitle as="h3">
                  <WorkflowIcon size={14} /> Equations & Connections ({equations.length})
                </SectionTitle>
                {equations.length > 0 ? (
                  <CodeBlockWrap>
                    <CodeBlockHeader>
                      <Text style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)" }}>
                        Declarative Equation & Connect Clauses
                      </Text>
                      <Label variant="secondary" style={{ fontSize: 11 }}>
                        {equations.length} {equations.length === 1 ? "equation" : "equations"}
                      </Label>
                    </CodeBlockHeader>
                    <CodeBlockPre>
                      <code>{equations.join("\n")}</code>
                    </CodeBlockPre>
                  </CodeBlockWrap>
                ) : (
                  <GlassCard>
                    <Text style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
                      No top-level equations or connect clauses declared directly in this class.
                    </Text>
                  </GlassCard>
                )}
              </JavadocSection>
            )}

            {activeTab === "source" && (
              <JavadocSection>
                <SectionTitle as="h3">
                  <FileCodeIcon size={14} /> Class Definition Source
                </SectionTitle>
                {cls.sourceCode ? (
                  <CodeBlockWrap>
                    <CodeBlockHeader>
                      <Box display="flex" alignItems="center" gap="8px">
                        <CodeIcon size={14} />
                        <Text
                          style={{
                            fontSize: 12,
                            fontFamily: "var(--font-mono, monospace)",
                            color: "var(--color-text-heading)",
                          }}
                        >
                          {cls.sourceFile || className}
                        </Text>
                      </Box>
                      <Button
                        size="small"
                        variant="invisible"
                        leadingVisual={copiedSource ? CheckIcon : CopyIcon}
                        onClick={handleCopySource}
                      >
                        {copiedSource ? "Copied" : "Copy"}
                      </Button>
                    </CodeBlockHeader>
                    <CodeBlockPre>
                      <code>{cls.sourceCode}</code>
                    </CodeBlockPre>
                  </CodeBlockWrap>
                ) : (
                  <GlassCard>
                    <Text style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
                      Source code is not available for this class.
                    </Text>
                  </GlassCard>
                )}
              </JavadocSection>
            )}
          </div>

          {/* ── Right Sidebar ── */}
          <aside>
            {/* Class icon */}
            <ClassIconBox>
              <InvertedSvg
                src={`${getIconUrl(name!, version!, className!)}?t=${retryCount}`}
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
                  <TypeLink to={`/packages/${name}/${version}`}>{name}</TypeLink>
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
                      const targetUrl =
                        name && version ? resolveTypeTargetUrl(base, name, version, allClasses, className) : null;
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
                <GlassCard
                  style={{ border: "1px solid rgba(6, 182, 212, 0.4)", background: "rgba(6, 182, 212, 0.05)" }}
                >
                  {twinInfo.twinTarget && (
                    <DetailRow style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                      <DetailLabel style={{ color: "#a855f7" }}>SysML v2 Twin</DetailLabel>
                      <Box display="flex" alignItems="center" justifyContent="space-between" width="100%">
                        {resolveTypeTargetUrl(twinInfo.twinTarget, name!, version!, allClasses, className) ? (
                          <TypeLink
                            to={resolveTypeTargetUrl(twinInfo.twinTarget, name!, version!, allClasses, className)!}
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
                    <DetailRow
                      style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, borderBottom: "none" }}
                    >
                      <DetailLabel style={{ color: "#fbbf24" }}>STEP CAD 3D Solid</DetailLabel>
                      <Box display="flex" alignItems="center" justifyContent="space-between" width="100%">
                        <Text style={{ fontSize: 13, fontWeight: 600, fontFamily: "monospace" }}>
                          {twinInfo.cadTarget}
                        </Text>
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
                            name!,
                            version!,
                            allClasses,
                            className,
                          );
                          if (cadClassUrl && cadClassUrl.includes("/classes/")) {
                            navigate(cadClassUrl);
                          } else {
                            navigate(`/packages/${name}/${version}?tab=artifacts`);
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
                      const targetUrl =
                        name && version
                          ? resolveTypeTargetUrl(comp.type_name, name, version, allClasses, className)
                          : null;
                      return (
                        <NavList.Item
                          key={comp.component_name}
                          style={{ color: "var(--color-text-primary)", cursor: "pointer" }}
                          onClick={(e) => {
                            e.preventDefault();
                            if (targetUrl && targetUrl.includes("/classes/")) {
                              navigate(targetUrl);
                            } else {
                              setActiveTab("parameters");
                            }
                          }}
                        >
                          <NavList.LeadingVisual>
                            <ComponentIconWrap>
                              <InvertedSvg
                                src={getIconUrl(name!, version!, comp.type_name)}
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
        </ContentGrid>
      </MainContentWrap>
    </PageWrap>
  );
};

export default ClassDetailPage;
