import { AlertIcon, ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { Heading, Label, Spinner, Text } from "@primer/react";
import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import styled, { css, keyframes } from "styled-components";
import type { ClassDetail, ClassSummary, JobStatus, LibraryVersion } from "../api";
import {
  getClassDetail,
  getClasses,
  getDiagramUrl,
  getIconUrl,
  getJobStatus,
  getLibraryDetail,
  rewriteModelicaUris,
} from "../api";
import Box from "../components/Box";
import Breadcrumbs from "../components/Breadcrumbs";

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
  flex-direction: column;
  transition:
    background-color 0.3s ease,
    color 0.3s ease;
`;

const ContentGrid = styled.div`
  max-width: 1280px;
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
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 40px 40px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--color-border);
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
  max-width: 60%;
  word-break: break-word;
`;

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

  img {
    max-width: 100%;
    filter: var(--diagram-filter);
  }
`;

const SectionTitle = styled(Heading)`
  font-size: 12px !important;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--color-text-muted) !important;
  margin-bottom: 12px !important;
  font-weight: 600 !important;
`;

/* ─── tree node types ─── */

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

  // Sort classes so parents are processed before children
  const sorted = [...classes].sort((a, b) => a.class_name.localeCompare(b.class_name));

  for (const cls of sorted) {
    const fullName = cls.class_name;
    // Only include direct children of the root
    if (!fullName.startsWith(rootName + ".")) continue;

    const parts = fullName.split(".");
    // Build intermediate nodes
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
        // Update classKind if this is the actual class
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
        to={`/${libraryName}/${version}/classes/${node.fullName}`}
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
        <img
          src={iconUrl}
          alt=""
          style={{ width: 16, height: 16, flexShrink: 0, filter: "var(--diagram-filter)" }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
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
          />
        ))}
    </>
  );
};

/* ─── format helpers ─── */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ─── main page ─── */

const LibraryDetailPage: React.FC = () => {
  const { name, version } = useParams<{ name: string; version: string }>();
  const [libraryInfo, setLibraryInfo] = useState<LibraryVersion | null>(null);
  const [rootClass, setRootClass] = useState<ClassDetail | null>(null);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [diagramLoaded, setDiagramLoaded] = useState(false);
  const [diagramError, setDiagramError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const fetchData = useCallback(async () => {
    if (!name || !version) return;
    try {
      const [libDetail, rootCls, classList] = await Promise.all([
        getLibraryDetail(name, version),
        getClassDetail(name, version, name).catch(() => null),
        getClasses(name, version),
      ]);
      setLibraryInfo(libDetail);
      setRootClass(rootCls);
      setClasses(classList);
    } catch (err) {
      setError("Failed to load library details");
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
      } catch (err) {
        console.error("Failed to check job status", err);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [name, version, jobStatus, fetchData]);

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
            Failed to load library details
          </Heading>
          <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 15, margin: 0, maxWidth: 400 }}>
            The library may not exist, is still being processed, or the server is unavailable.
          </Text>
          <Link to="/libraries" style={{ color: "var(--color-link)", fontSize: 14, textDecoration: "none" }}>
            ← Back to libraries
          </Link>
        </Box>
      </PageWrap>
    );
  }

  const tree = name ? buildClassTree(classes, name) : [];

  return (
    <PageWrap>
      {/* ── Header ── */}
      <HeaderBar>
        <Box mb={3}>
          <Breadcrumbs
            items={[
              { label: "Libraries", href: "/libraries" },
              { label: name || "", href: `/${name}` },
              { label: version || "" },
            ]}
          />
        </Box>
        <Box display="flex" alignItems="center" gap="16px">
          {/* Library icon */}
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
            <img
              src={getIconUrl(name!, version!, name!)}
              alt=""
              style={{ width: 36, height: 36, filter: "var(--diagram-filter)" }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
                // Show fallback icon
                const parent = (e.target as HTMLImageElement).parentElement;
                if (parent && !parent.querySelector("svg")) {
                  // Icon will remain as gradient background
                }
              }}
            />
          </Box>
          <Box>
            <Box display="flex" alignItems="center" gap="8px">
              <Heading as="h1" style={{ color: "var(--color-text-heading)", fontWeight: 700, fontSize: 28, margin: 0 }}>
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
              {jobStatus && jobStatus !== "completed" && (
                <Label variant="attention">{jobStatus === "processing" ? "Processing…" : "Pending"}</Label>
              )}
            </Box>
            {libraryInfo?.description && (
              <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 15, margin: "4px 0 0" }}>
                {libraryInfo.description}
              </Text>
            )}
          </Box>
        </Box>
      </HeaderBar>

      {/* ── Body ── */}
      <ContentGrid>
        {/* ── Main column ── */}
        <div>
          {/* Root class diagram */}
          {!diagramError && diagramLoaded && (
            <DiagramWrap>
              <img
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
          )}
          {!diagramError && !diagramLoaded && (
            <img
              src={`${getDiagramUrl(name!, version!, name!)}?t=${retryCount}`}
              alt=""
              style={{ display: "none" }}
              onLoad={() => setDiagramLoaded(true)}
              onError={() => {
                if (jobStatus && jobStatus !== "completed" && jobStatus !== "failed") {
                  setTimeout(() => setRetryCount((p) => p + 1), 3000);
                } else {
                  setDiagramError(true);
                }
              }}
            />
          )}

          {/* Documentation */}
          <SectionTitle as="h3">Readme</SectionTitle>
          <DocCard>
            {rootClass?.documentation ? (
              <div dangerouslySetInnerHTML={{ __html: rewriteModelicaUris(rootClass.documentation, version!) }} />
            ) : rootClass?.description ? (
              <Text as="p" style={{ color: "var(--color-text-primary)", lineHeight: 1.7, margin: 0 }}>
                {rootClass.description}
              </Text>
            ) : (
              <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
                No documentation available for this library.
              </Text>
            )}
          </DocCard>
        </div>

        {/* ── Sidebar ── */}
        <aside>
          {/* Library details */}
          <SectionTitle as="h3">Library Details</SectionTitle>
          <GlassCard>
            <DetailRow>
              <DetailLabel>Name</DetailLabel>
              <DetailValue>{name}</DetailValue>
            </DetailRow>
            <DetailRow>
              <DetailLabel>Version</DetailLabel>
              <DetailValue>{version}</DetailValue>
            </DetailRow>
            {libraryInfo?.description && (
              <DetailRow>
                <DetailLabel>Description</DetailLabel>
                <DetailValue>{libraryInfo.description}</DetailValue>
              </DetailRow>
            )}
            {libraryInfo?.modelicaVersion && (
              <DetailRow>
                <DetailLabel>Modelica Version</DetailLabel>
                <DetailValue>{libraryInfo.modelicaVersion}</DetailValue>
              </DetailRow>
            )}
            {libraryInfo && (
              <DetailRow>
                <DetailLabel>Size</DetailLabel>
                <DetailValue>{formatBytes(libraryInfo.size)}</DetailValue>
              </DetailRow>
            )}
            {rootClass && (
              <DetailRow>
                <DetailLabel>Type</DetailLabel>
                <DetailValue>
                  <Label variant="accent" style={{ fontSize: 11 }}>
                    {rootClass.classKind}
                  </Label>
                </DetailValue>
              </DetailRow>
            )}
          </GlassCard>

          {/* Class tree */}
          {tree.length > 0 && (
            <>
              <SectionTitle as="h3" style={{ marginTop: 24 }}>
                Classes
              </SectionTitle>
              <GlassCard style={{ padding: "8px 4px", maxHeight: "calc(100vh - 400px)", overflowY: "auto" }}>
                {tree.map((node) => (
                  <ClassTreeNode key={node.fullName} node={node} depth={0} libraryName={name!} version={version!} />
                ))}
              </GlassCard>
            </>
          )}
        </aside>
      </ContentGrid>
    </PageWrap>
  );
};

export default LibraryDetailPage;
