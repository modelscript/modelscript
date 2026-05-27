import {
  AlertIcon,
  BookIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  DependabotIcon,
  FileIcon,
  HistoryIcon,
  LinkIcon,
  VerifiedIcon,
} from "@primer/octicons-react";
import { Heading, Label, Spinner, Text } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import styled, { css, keyframes } from "styled-components";
import type {
  ArtifactViewerInfo,
  ClassDetail,
  ClassSummary,
  JobStatus,
  NpmPackument,
  NpmVersionManifest,
} from "../api";
import {
  getArtifactViewers,
  getClassDetail,
  getClasses,
  getDiagramUrl,
  getIconUrl,
  getJobStatus,
  getPackument,
  rewriteModelicaUris,
} from "../api";
import Box from "../components/Box";
import Breadcrumbs from "../components/Breadcrumbs";
import CadStepViewer from "../components/CadStepViewer.tsx";
import DatasetTableViewer from "../components/DatasetTableViewer.tsx";
import FmuSimulatorViewer from "../components/FmuSimulatorViewer.tsx";
import InvertedSvg from "../components/InvertedSvg";
import SysmlViewer from "../components/SysmlViewer.tsx";

/* ─── animations ─── */

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

/* ─── styled components ─── */

const PageWrap = styled.div`
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  min-height: 100%;
  display: flex;
  flex-direction: row;
  transition:
    background-color 0.3s ease,
    color 0.3s ease;
`;

const TreeSidebar = styled.div`
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  height: 100vh;
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
`;

const TreeScrollArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px 8px;

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

const ContentGrid = styled.div`
  max-width: none;
  margin: 0 auto;
  padding: 0 40px 60px;
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 40px;
  width: 100%;
  box-sizing: border-box;
  animation: ${fadeIn} 0.4s ease;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const HeaderBar = styled.div`
  max-width: none;
  width: 100%;
  margin: 0 auto;
  padding: 32px 40px 0;
  box-sizing: border-box;
`;

const glassCard = css`
  background: var(--color-glass-bg);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-glass-border);
  border-radius: 8px;
`;

const GlassCard = styled.div`
  ${glassCard}
  padding: 20px;
  margin-bottom: 16px;
`;

const DocCard = styled.div`
  ${glassCard}
  padding: 32px;

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

const SectionTitle = styled(Heading)`
  font-size: 14px !important;
  color: var(--color-text-muted) !important;
  margin-bottom: 12px !important;
  font-weight: 600 !important;
`;

const MetaGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 24px;
`;

const MetaBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 24px;
`;

const MetaLabel = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
`;

const MetaValue = styled.span`
  font-size: 14px;
  color: var(--color-text-heading);
  font-weight: 600;
  word-break: break-word;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Divider = styled.hr`
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 24px 0;
`;

/* ─── tab bar ─── */

const TabBar = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--color-border);
  margin-bottom: 24px;
  max-width: none;
  width: 100%;
  margin-left: auto;
  margin-right: auto;
  padding: 0 40px;
  box-sizing: border-box;
`;

const Tab = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 20px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  border-bottom: 2px solid ${(p) => (p.$active ? "var(--color-accent, #6366f1)" : "transparent")};
  margin-bottom: -2px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    color: var(--color-text-heading);
  }
`;

/* ─── install copy box ─── */

const InstallBox = styled.div`
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 12px 16px;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 13px;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: border-color 0.2s;

  &:hover {
    border-color: var(--color-border-strong);
  }

  code {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    &::before {
      content: "> ";
      color: var(--color-text-muted);
    }
  }

  .copy-icon {
    flex-shrink: 0;
    color: var(--color-text-muted);
    transition: color 0.2s;
  }

  &:hover .copy-icon {
    color: var(--color-text-primary);
  }
`;

/* ─── tree components ─── */

const TreeItem = styled(Link)<{ $depth: number }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px 5px ${(p) => 8 + p.$depth * 16}px;
  font-size: 13px;
  color: var(--color-text-primary);
  text-decoration: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
  &:hover {
    background: var(--color-glass-bg-hover);
    color: var(--color-text-heading);
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

const DiagramWrap = styled.div`
  ${glassCard}
  padding: 24px;
  margin-bottom: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 120px;
  overflow: auto;
  svg {
    max-width: 100%;
  }
`;

/* ─── version row ─── */

const VersionRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);

  &:last-child {
    border-bottom: none;
  }
`;

/* ─── artifact card ─── */

const ArtifactCard = styled.div`
  ${glassCard}
  padding: 16px 20px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: border-color 0.2s;

  &:hover {
    border-color: var(--color-border-strong);
  }
`;

const ArtifactBadge = styled.span<{ $type: string }>`
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: ${(p) => {
    switch (p.$type) {
      case "fmu":
        return "rgba(255, 107, 107, 0.15)";
      case "wasm":
        return "rgba(139, 92, 246, 0.15)";
      case "dataset":
        return "rgba(59, 130, 246, 0.15)";
      default:
        return "rgba(107, 114, 128, 0.15)";
    }
  }};
  color: ${(p) => {
    switch (p.$type) {
      case "fmu":
        return "#ff6b6b";
      case "wasm":
        return "#8b5cf6";
      case "dataset":
        return "#3b82f6";
      default:
        return "#6b7280";
    }
  }};
`;

/* ─── dependency row ─── */

const DepRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
  &:last-child {
    border-bottom: none;
  }
`;

/* ─── tree helpers ─── */

interface TreeNode {
  name: string;
  fullName: string;
  classKind: string;
  children: TreeNode[];
}

function buildClassTree(classes: ClassSummary[], rootName: string): TreeNode[] {
  const root: TreeNode = { name: rootName, fullName: rootName, classKind: "package", children: [] };
  const nodeMap = new Map<string, TreeNode>();
  nodeMap.set(rootName, root);

  const sorted = [...classes].sort((a, b) => a.class_name.localeCompare(b.class_name));

  for (const cls of sorted) {
    const fullName = cls.class_name;
    if (!fullName.startsWith(rootName + ".")) continue;

    const parts = fullName.split(".");
    for (let i = 1; i < parts.length; i++) {
      const partialName = parts.slice(0, i + 1).join(".");
      if (!nodeMap.has(partialName)) {
        const node: TreeNode = {
          name: parts[i],
          fullName: partialName,
          classKind: cls.class_name === partialName ? cls.class_kind : "package",
          children: [],
        };
        nodeMap.set(partialName, node);
        const parentName = parts.slice(0, i).join(".");
        const parent = nodeMap.get(parentName);
        if (parent) parent.children.push(node);
      } else if (cls.class_name === partialName) {
        const existing = nodeMap.get(partialName)!;
        existing.classKind = cls.class_kind;
      }
    }
  }

  return root.children;
}

/* ─── tree node component ─── */

const ClassTreeNode: React.FC<{
  node: TreeNode;
  depth: number;
  libraryName: string;
  version: string;
}> = ({ node, depth, libraryName, version }) => {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const iconUrl = getIconUrl(libraryName, version, node.fullName);

  return (
    <>
      <TreeItem
        to={`/packages/${libraryName}/${version}/classes/${node.fullName}`}
        $depth={depth}
        onClick={(e) => {
          if (hasChildren) {
            e.preventDefault();
            setExpanded(!expanded);
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
        <InvertedSvg src={iconUrl} alt="" width={16} height={16} />
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
          />
        ))}
    </>
  );
};

/* ─── format helpers ─── */

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function timeAgo(dateStr: string): string {
  try {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 1) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays < 30) return `${diffDays} days ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  } catch {
    return "";
  }
}

/* ─── tab types ─── */

type TabId = "readme" | "versions" | "artifacts" | "dependencies";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "readme", label: "Readme", icon: <BookIcon size={16} /> },
  { id: "versions", label: "Versions", icon: <HistoryIcon size={16} /> },
  { id: "artifacts", label: "Artifacts", icon: <FileIcon size={16} /> },
  { id: "dependencies", label: "Dependencies", icon: <DependabotIcon size={16} /> },
];

/* ─── main page ─── */

const PackageDetailPage: React.FC = () => {
  const { name, version } = useParams<{ name: string; version: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabId) || "readme";

  // Legacy API data
  const [rootClass, setRootClass] = useState<ClassDetail | null>(null);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [diagramLoaded, setDiagramLoaded] = useState(false);
  const [diagramError, setDiagramError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [copied, setCopied] = useState(false);

  // npm packument data
  const [packument, setPackument] = useState<NpmPackument | null>(null);

  // Enriched artifact data from artifact viewer API
  const [artifactViewers, setArtifactViewers] = useState<ArtifactViewerInfo[]>([]);

  const setTab = (tab: TabId) => {
    setSearchParams({ tab });
  };

  const fetchData = useCallback(async () => {
    if (!name || !version) return;
    try {
      const [rootCls, classList, npmData, viewers] = await Promise.all([
        getClassDetail(name, version, name).catch(() => null),
        getClasses(name, version),
        getPackument(name).catch(() => null),
        getArtifactViewers(name, version).catch(() => []),
      ]);
      setRootClass(rootCls);
      setClasses(classList);
      setPackument(npmData);
      setArtifactViewers(viewers);
    } catch (err) {
      setError("Failed to load package details");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [name, version]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (name && version) {
      document.title = `${name}@${version} | ModelScript`;
    }
  }, [name, version]);

  // Job polling
  useEffect(() => {
    if (!name || !version || jobStatus === "completed" || jobStatus === "failed") return;

    const checkStatus = async () => {
      try {
        const status = await getJobStatus(name, version);
        setJobStatus(status.status);
        if (status.status === "completed") {
          fetchData();
        }
      } catch (err: unknown) {
        const error = err as { response?: { status?: number } };
        if (error?.response?.status === 404) {
          setJobStatus("failed"); // No job exists, don't poll forever
        } else {
          console.error("Failed to check job status", err);
        }
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [name, version, jobStatus, fetchData]);

  // Derived data from packument
  const currentManifest: NpmVersionManifest | null =
    packument && version ? (packument.versions[version] ?? null) : null;
  const versionList = packument
    ? Object.keys(packument.versions).sort((a, b) => {
        const ta = packument.time?.[a] ?? "";
        const tb = packument.time?.[b] ?? "";
        return tb.localeCompare(ta);
      })
    : [];
  const artifacts = currentManifest?.modelscript?.artifacts ?? [];
  const dependencies = currentManifest?.dependencies ?? {};
  const publishedAt = packument?.time?.[version ?? ""] ?? packument?.time?.modified ?? "";

  // Install command
  const installCmd = `npm i ${name}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <PageWrap style={{ justifyContent: "center", alignItems: "center" }}>
        <Spinner size="large" />
      </PageWrap>
    );
  }

  if (error) {
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
            Failed to load package details
          </Heading>
          <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 15, margin: 0, maxWidth: 400 }}>
            The package may not exist, is still being processed, or the server is unavailable.
          </Text>
          <Link to="/packages" style={{ color: "var(--color-link)", fontSize: 14, textDecoration: "none" }}>
            ← Back to libraries
          </Link>
        </Box>
      </PageWrap>
    );
  }

  const tree = name ? buildClassTree(classes, name) : [];
  const description = packument?.description ?? rootClass?.description ?? null;

  return (
    <PageWrap>
      {/* ── Left Sidebar (Classes) ── */}
      {tree.length > 0 && (
        <TreeSidebar>
          <Box
            style={{
              height: "84px",
              minHeight: "84px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "0 16px",
              boxSizing: "border-box",
            }}
          >
            <Box
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: "var(--gradient-icon-box)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                border: "1px solid var(--color-border-strong)",
              }}
            >
              <InvertedSvg src={getIconUrl(name!, version!, name!)} alt="" width={24} height={24} />
            </Box>
            <Box display="flex" flexDirection="column">
              <Text style={{ fontWeight: 600, fontSize: 14, color: "var(--color-text-primary)", lineHeight: 1.2 }}>
                {name}
              </Text>
              <Text style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: "2px" }}>v{version}</Text>
            </Box>
          </Box>

          <TreeScrollArea>
            <Divider style={{ marginTop: 0, marginBottom: 12 }} />
            {tree.map((node) => (
              <ClassTreeNode key={node.fullName} node={node} depth={0} libraryName={name!} version={version!} />
            ))}
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
                { label: version || "" },
              ]}
            />
          </Box>
          <Box display="flex" alignItems="center" gap="16px" mb={3}>
            {/* Package icon */}
            <Box
              style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                background: "var(--gradient-icon-box)",
                border: "1px solid var(--color-border-strong)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                overflow: "hidden",
              }}
            >
              <InvertedSvg src={getIconUrl(name!, version!, name!)} alt="" width={36} height={36} />
            </Box>
            <Box>
              <Box display="flex" alignItems="center" gap="8px">
                <Heading
                  as="h1"
                  style={{ color: "var(--color-text-heading)", fontWeight: 700, fontSize: 28, margin: 0 }}
                >
                  {name}
                </Heading>
                <Label
                  variant="accent"
                  style={{
                    fontSize: 14,
                    padding: "2px 10px",
                    background: "var(--color-accent-blue-bg)",
                    color: "var(--color-accent-blue)",
                    border: "1px solid var(--color-accent-blue-border)",
                  }}
                >
                  {version}
                </Label>
                {jobStatus && jobStatus !== "completed" && jobStatus !== "failed" && (
                  <Label
                    variant="attention"
                    style={
                      jobStatus === "processing" ? { display: "flex", alignItems: "center", gap: "6px" } : undefined
                    }
                  >
                    {jobStatus === "processing" && <Spinner size="small" />}
                    {jobStatus === "processing" ? "Processing…" : "Pending"}
                  </Label>
                )}
                {packument?.license && (
                  <Label variant="secondary" style={{ fontSize: 11 }}>
                    {packument.license}
                  </Label>
                )}
              </Box>
              {description && (
                <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 15, margin: "4px 0 0" }}>
                  {description}
                </Text>
              )}
              {publishedAt && (
                <Text as="p" style={{ color: "var(--color-text-tertiary)", fontSize: 12, margin: "2px 0 0" }}>
                  Published {timeAgo(publishedAt)}
                </Text>
              )}
            </Box>
          </Box>
        </HeaderBar>

        {/* ── Tabs ── */}
        <TabBar>
          {TABS.map((tab) => (
            <Tab key={tab.id} $active={activeTab === tab.id} onClick={() => setTab(tab.id)}>
              {tab.icon}
              {tab.label}
              {tab.id === "artifacts" && (artifactViewers.length > 0 || artifacts.length > 0) && (
                <Label variant="secondary" style={{ fontSize: 10, padding: "0 4px", marginLeft: 4 }}>
                  {artifactViewers.length || artifacts.length}
                </Label>
              )}
              {tab.id === "dependencies" && Object.keys(dependencies).length > 0 && (
                <Label variant="secondary" style={{ fontSize: 10, padding: "0 4px", marginLeft: 4 }}>
                  {Object.keys(dependencies).length}
                </Label>
              )}
            </Tab>
          ))}
        </TabBar>

        {/* ── Body ── */}
        <ContentGrid>
          {/* ── Main column ── */}
          <div>
            {/* README tab */}
            {activeTab === "readme" && (
              <>
                {/* Root class diagram */}
                {!diagramError && (
                  <div style={diagramLoaded ? undefined : { position: "absolute", opacity: 0, pointerEvents: "none" }}>
                    <DiagramWrap>
                      <InvertedSvg
                        src={`${getDiagramUrl(name!, version!, name!)}?t=${retryCount}`}
                        alt={`${name} diagram`}
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

                <DocCard>
                  {rootClass?.documentation ? (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(rewriteModelicaUris(rootClass.documentation, version!)),
                      }}
                    />
                  ) : packument?.readme && !packument.readme.includes("ERROR: No README data found!") ? (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(packument.readme),
                      }}
                    />
                  ) : rootClass?.description ? (
                    <Text as="p" style={{ color: "var(--color-text-primary)", lineHeight: 1.7, margin: 0 }}>
                      {rootClass.description}
                    </Text>
                  ) : (
                    <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
                      No documentation available for this package.
                    </Text>
                  )}
                </DocCard>
              </>
            )}

            {/* Versions tab */}
            {activeTab === "versions" && (
              <>
                <SectionTitle as="h3">Version History</SectionTitle>
                <GlassCard>
                  {versionList.length > 0 ? (
                    versionList.map((v) => (
                      <VersionRow key={v}>
                        <Box display="flex" alignItems="center" gap="8px">
                          <Link
                            to={`/packages/${name}/${v}`}
                            style={{
                              color: "var(--color-link)",
                              textDecoration: "none",
                              fontWeight: v === version ? 600 : 400,
                              fontSize: 14,
                            }}
                          >
                            {v}
                          </Link>
                          {packument?.["dist-tags"]?.["latest"] === v && (
                            <Label variant="accent" style={{ fontSize: 10, padding: "0 6px" }}>
                              latest
                            </Label>
                          )}
                          {v === version && (
                            <Label variant="success" style={{ fontSize: 10, padding: "0 6px" }}>
                              current
                            </Label>
                          )}
                        </Box>
                        <Text style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
                          {packument?.time?.[v] ? formatDate(packument.time[v]) : ""}
                        </Text>
                      </VersionRow>
                    ))
                  ) : (
                    <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
                      No version history available.
                    </Text>
                  )}
                </GlassCard>
              </>
            )}

            {/* Artifacts tab */}
            {activeTab === "artifacts" && (
              <>
                <SectionTitle as="h3">Bundled Artifacts</SectionTitle>
                <Text as="p" style={{ color: "var(--color-text-muted)", marginBottom: 24, fontSize: 14 }}>
                  Artifacts are compiled resources, datasets, or external files bundled with this package version. They
                  provide pre-compiled simulations (FMUs), CAD models, or supplementary data that can be executed or
                  viewed directly in the browser.
                </Text>

                {/* Render enriched artifact viewers from the API */}
                {artifactViewers.length > 0 ? (
                  artifactViewers.map((av) => {
                    // Render interactive viewers based on handler-provided descriptors
                    if (av.viewer?.viewer === "fmu-simulator") {
                      return (
                        <FmuSimulatorViewer
                          key={av.id}
                          config={
                            av.viewer.config as Record<string, unknown> & {
                              fmiVersion?: string;
                              modelName?: string;
                              hasWasm?: boolean;
                              inputs?: {
                                name: string;
                                valueReference: number;
                                causality: string;
                                variability: string;
                                type: string;
                                start?: string;
                                unit?: string;
                                description?: string;
                              }[];
                              outputs?: {
                                name: string;
                                valueReference: number;
                                causality: string;
                                variability: string;
                                type: string;
                                start?: string;
                                unit?: string;
                                description?: string;
                              }[];
                              parameters?: {
                                name: string;
                                valueReference: number;
                                causality: string;
                                variability: string;
                                type: string;
                                start?: string;
                                unit?: string;
                                description?: string;
                              }[];
                              platforms?: string[];
                            }
                          }
                          artifactPath={av.path}
                        />
                      );
                    }

                    if (av.viewer?.viewer === "dataset-table") {
                      return (
                        <DatasetTableViewer
                          key={av.id}
                          config={
                            av.viewer.config as Record<string, unknown> & {
                              columns?: {
                                name: string;
                                type: "number" | "string" | "boolean";
                                min?: number;
                                max?: number;
                                mean?: number;
                                unique?: number;
                              }[];
                              rowCount?: number;
                              format?: string;
                              previewRows?: string[][];
                              hasHeader?: boolean;
                            }
                          }
                          artifactPath={av.path}
                        />
                      );
                    }

                    if (av.viewer?.viewer === "cad-3d-viewer") {
                      return <CadStepViewer key={av.id} config={av.viewer.config} artifactPath={av.path} />;
                    }

                    if (av.viewer?.viewer === "sysml-architecture-viewer") {
                      return <SysmlViewer key={av.id} config={av.viewer.config} artifactPath={av.path} />;
                    }

                    // Fallback: render a generic artifact card for unrecognized types
                    return (
                      <ArtifactCard key={av.id}>
                        <ArtifactBadge $type={av.type}>{av.type}</ArtifactBadge>
                        <Box flex={1}>
                          <Text style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-heading)" }}>
                            {av.path}
                          </Text>
                          <Text as="p" style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                            {av.displayName}
                          </Text>
                        </Box>
                      </ArtifactCard>
                    );
                  })
                ) : artifacts.length > 0 ? (
                  // Fallback to basic artifact list from packument metadata
                  artifacts.map((artifact, i) => (
                    <ArtifactCard key={i}>
                      <ArtifactBadge $type={artifact.type}>{artifact.type}</ArtifactBadge>
                      <Box flex={1}>
                        <Text style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-heading)" }}>
                          {artifact.path}
                        </Text>
                        {artifact.description && (
                          <Text as="p" style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                            {artifact.description}
                          </Text>
                        )}
                      </Box>
                      {artifact.fmiVersion && (
                        <Label variant="secondary" style={{ fontSize: 10 }}>
                          FMI {artifact.fmiVersion}
                        </Label>
                      )}
                      {artifact.platforms && (
                        <Box display="flex" gap="4px">
                          {artifact.platforms.map((p) => (
                            <Label key={p} variant="secondary" style={{ fontSize: 10 }}>
                              {p}
                            </Label>
                          ))}
                        </Box>
                      )}
                    </ArtifactCard>
                  ))
                ) : (
                  <GlassCard>
                    <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
                      No artifacts bundled with this version.
                    </Text>
                  </GlassCard>
                )}
              </>
            )}

            {/* Dependencies tab */}
            {activeTab === "dependencies" && (
              <>
                <SectionTitle as="h3">Dependencies</SectionTitle>
                <GlassCard>
                  {Object.keys(dependencies).length > 0 ? (
                    Object.entries(dependencies).map(([dep, range]) => (
                      <DepRow key={dep}>
                        <Link
                          to={`/packages/${dep}`}
                          style={{ color: "var(--color-link)", textDecoration: "none", fontSize: 14 }}
                        >
                          {dep}
                        </Link>
                        <Text style={{ color: "var(--color-text-muted)", fontSize: 13, fontFamily: "monospace" }}>
                          {range}
                        </Text>
                      </DepRow>
                    ))
                  ) : (
                    <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
                      No dependencies.
                    </Text>
                  )}
                </GlassCard>

                {currentManifest?.devDependencies && Object.keys(currentManifest.devDependencies).length > 0 && (
                  <>
                    <SectionTitle as="h3" style={{ marginTop: 24 }}>
                      Dev Dependencies
                    </SectionTitle>
                    <GlassCard>
                      {Object.entries(currentManifest.devDependencies).map(([dep, range]) => (
                        <DepRow key={dep}>
                          <Text style={{ color: "var(--color-text-primary)", fontSize: 14 }}>{dep}</Text>
                          <Text style={{ color: "var(--color-text-muted)", fontSize: 13, fontFamily: "monospace" }}>
                            {range}
                          </Text>
                        </DepRow>
                      ))}
                    </GlassCard>
                  </>
                )}
              </>
            )}
          </div>

          {/* ── Sidebar ── */}
          <aside style={{ display: "flex", flexDirection: "column" }}>
            <MetaLabel style={{ marginBottom: 12 }}>Install</MetaLabel>
            <InstallBox onClick={handleCopy} title="Click to copy">
              <code>{installCmd}</code>
              <span className="copy-icon">{copied ? <VerifiedIcon size={16} /> : <CopyIcon size={16} />}</span>
            </InstallBox>

            {packument?.repository?.url && (
              <MetaBlock>
                <MetaLabel>Repository</MetaLabel>
                <MetaValue>
                  <BookIcon size={16} />
                  <a
                    href={packument.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--color-heading)", textDecoration: "none" }}
                  >
                    {packument.repository.url.replace(/^git\+https:\/\//, "").replace(/\.git$/, "")}
                  </a>
                </MetaValue>
              </MetaBlock>
            )}

            {packument?.homepage && (
              <MetaBlock>
                <MetaLabel>Homepage</MetaLabel>
                <MetaValue>
                  <LinkIcon size={16} />
                  <a
                    href={packument.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--color-heading)", textDecoration: "none" }}
                  >
                    {packument.homepage.replace(/^https?:\/\//, "")}
                  </a>
                </MetaValue>
              </MetaBlock>
            )}

            <Divider />

            <MetaGrid>
              <MetaBlock style={{ marginBottom: 0 }}>
                <MetaLabel>Version</MetaLabel>
                <MetaValue>{version}</MetaValue>
              </MetaBlock>
              {packument?.license && (
                <MetaBlock style={{ marginBottom: 0 }}>
                  <MetaLabel>License</MetaLabel>
                  <MetaValue>{packument.license}</MetaValue>
                </MetaBlock>
              )}
            </MetaGrid>

            <MetaBlock>
              <MetaLabel>Last publish</MetaLabel>
              <MetaValue>{publishedAt ? timeAgo(publishedAt) : "—"}</MetaValue>
            </MetaBlock>

            {currentManifest?.modelscript?.modelicaVersion && (
              <MetaBlock>
                <MetaLabel>Modelica Version</MetaLabel>
                <MetaValue>{currentManifest.modelscript.modelicaVersion}</MetaValue>
              </MetaBlock>
            )}

            <Divider />
          </aside>
        </ContentGrid>
      </MainContentWrap>
    </PageWrap>
  );
};

export default PackageDetailPage;
