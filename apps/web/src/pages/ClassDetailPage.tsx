import { AlertIcon, PackageIcon } from "@primer/octicons-react";
import { Heading, Label, NavList, Spinner, Text, Truncate } from "@primer/react";
import DOMPurify from "dompurify";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import styled, { css, keyframes } from "styled-components";
import type { ClassDetail, ClassSummary, JobStatus } from "../api";
import { getClassDetail, getClasses, getDiagramUrl, getIconUrl, getJobStatus, rewriteModelicaUris } from "../api";
import Box from "../components/Box";
import Breadcrumbs from "../components/Breadcrumbs";
import { ClassTreeNode } from "../components/ClassTree";
import { buildClassTree } from "../components/classTreeUtils";
import InvertedSvg from "../components/InvertedSvg";

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
  width: 260px;
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

const Divider = styled.hr`
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 24px 0;
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
  padding: 0;

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
  width: 32px;
  height: 32px;

  > div[role="img"],
  > div[role="img"] > svg,
  > svg {
    width: 32px !important;
    height: 32px !important;
  }
`;

/* ─── main page ─── */

const ClassDetailPage: React.FC = () => {
  const { name, version, className } = useParams<{ name: string; version: string; className: string }>();
  const [cls, setCls] = useState<ClassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [diagramLoaded, setDiagramLoaded] = useState(false);
  const [diagramError, setDiagramError] = useState(false);
  const [allClasses, setAllClasses] = useState<ClassSummary[]>([]);

  // Fetch all classes for the tree
  useEffect(() => {
    if (!name || !version) return;
    getClasses(name, version)
      .then(setAllClasses)
      .catch(() => {});
  }, [name, version]);

  const tree = useMemo(() => {
    if (!name || allClasses.length === 0) return [];
    return buildClassTree(allClasses, name);
  }, [allClasses, name]);

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
    if (className && name && version) {
      document.title = `${className} | ${name}@${version} | ModelScript`;
    }
  }, [className, name, version]);

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
            <InvertedSvg
              src={getIconUrl(name!, version!, name!)}
              alt=""
              width={32}
              height={32}
              style={{ flexShrink: 0 }}
            />
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
              <ClassTreeNode
                key={node.fullName}
                node={node}
                depth={0}
                libraryName={name!}
                version={version!}
                activeClassName={className}
              />
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
          <Box display="flex" alignItems="center" gap="16px">
            <Box>
              <Box display="flex" alignItems="center" gap="8px">
                <Heading
                  as="h1"
                  style={{ color: "var(--color-text-heading)", fontWeight: 700, fontSize: 28, margin: 0 }}
                >
                  {className}
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
                  {cls.classKind}
                </Label>
                {jobStatus && jobStatus !== "completed" && (
                  <Label variant="attention">{jobStatus === "processing" ? "Processing…" : "Pending"}</Label>
                )}
              </Box>
              {cls.description && (
                <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 15, margin: "4px 0 0" }}>
                  {cls.description}
                </Text>
              )}
            </Box>
          </Box>
        </HeaderBar>

        {/* ── Body ── */}
        <ContentGrid>
          {/* ── Main column ── */}
          <div style={{ minWidth: 0 }}>
            {/* Class diagram */}
            {!diagramError && (
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
            <DocCard>
              {cls.documentation ? (
                <div
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(rewriteModelicaUris(cls.documentation, version!)),
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
          </div>

          {/* ── Sidebar ── */}
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
                <DetailValue>{name}</DetailValue>
              </DetailRow>
              <DetailRow>
                <DetailLabel>Version</DetailLabel>
                <DetailValue>{version}</DetailValue>
              </DetailRow>
              {cls.extends.length > 0 && (
                <>
                  <DetailRow style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                    <DetailLabel>Extends</DetailLabel>
                    <Box display="flex" gap="6px" flexWrap="wrap">
                      {cls.extends.map((base) => (
                        <Label key={base} variant="secondary" style={{ fontSize: 11 }}>
                          {base}
                        </Label>
                      ))}
                    </Box>
                  </DetailRow>
                </>
              )}
            </GlassCard>

            {/* Components */}
            {cls.components.length > 0 && (
              <>
                <SectionTitle as="h3" style={{ marginTop: 24 }}>
                  Components
                </SectionTitle>
                <GlassCard style={{ padding: "8px", maxHeight: "calc(100vh - 400px)", overflowY: "auto" }}>
                  <NavList>
                    {cls.components.map((comp) => (
                      <NavList.Item key={comp.component_name} style={{ color: "var(--color-text-primary)" }}>
                        <NavList.LeadingVisual>
                          <ComponentIconWrap>
                            <InvertedSvg
                              src={getIconUrl(name!, version!, comp.type_name)}
                              fallback={<PackageIcon size={16} />}
                              alt=""
                            />
                          </ComponentIconWrap>
                        </NavList.LeadingVisual>
                        <Box fontWeight="bold" style={{ color: "var(--color-text-heading)" }}>
                          {comp.component_name}
                        </Box>
                        <Box fontSize="12px" opacity={0.6}>
                          <Truncate title={comp.type_name}>{comp.type_name}</Truncate>
                        </Box>
                        {comp.description && (
                          <Box fontSize="12px" opacity={0.8} mt={1}>
                            {comp.description}
                          </Box>
                        )}
                      </NavList.Item>
                    ))}
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
