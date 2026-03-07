import { AlertIcon } from "@primer/octicons-react";
import { Heading, Label, NavList, Spinner, Text, Truncate } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import styled, { css, keyframes } from "styled-components";
import type { ClassDetail, ClassSummary, JobStatus } from "../api";
import { getClassDetail, getClasses, getDiagramUrl, getIconUrl, getJobStatus, rewriteModelicaUris } from "../api";
import Box from "../components/Box";
import Breadcrumbs from "../components/Breadcrumbs";
import { buildClassTree, ClassTreeNode } from "../components/ClassTree";

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
      {/* ── Header ── */}
      <HeaderBar>
        <Box mb={3}>
          <Breadcrumbs
            items={[
              { label: "Libraries", href: "/libraries" },
              { label: name || "", href: `/${name}` },
              { label: version || "", href: `/${name}/${version}` },
              ...(className || "").split(".").map((segment, i, parts) => {
                const fullName = parts.slice(0, i + 1).join(".");
                const isLast = i === parts.length - 1;
                return {
                  label: segment,
                  href: isLast ? undefined : `/${name}/${version}/classes/${fullName}`,
                };
              }),
            ]}
          />
        </Box>
        <Box display="flex" alignItems="center" gap="16px">
          {/* Class icon */}
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
              src={`${getIconUrl(name!, version!, className!)}?t=${retryCount}`}
              alt=""
              style={{ width: 36, height: 36, filter: "var(--diagram-filter)" }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </Box>
          <Box>
            <Box display="flex" alignItems="center" gap="8px">
              <Heading as="h1" style={{ color: "var(--color-text-heading)", fontWeight: 700, fontSize: 28, margin: 0 }}>
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
        <div>
          {/* Class diagram */}
          {!diagramError && diagramLoaded && (
            <>
              <SectionTitle as="h3">Diagram</SectionTitle>
              <DiagramWrap>
                <img
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
            </>
          )}
          {/* Hidden loader to trigger loading */}
          {!diagramError && !diagramLoaded && (
            <img
              src={`${getDiagramUrl(name!, version!, className!)}?t=${retryCount}`}
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
          <SectionTitle as="h3">Documentation</SectionTitle>
          <DocCard>
            {cls.documentation ? (
              <div dangerouslySetInnerHTML={{ __html: rewriteModelicaUris(cls.documentation, version!) }} />
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

          {/* Class tree */}
          {tree.length > 0 && (
            <>
              <SectionTitle as="h3" style={{ marginTop: 24 }}>
                Explorer
              </SectionTitle>
              <GlassCard style={{ padding: "8px", maxHeight: "40vh", overflowY: "auto" }}>
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
              </GlassCard>
            </>
          )}

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
                        <img
                          src={getIconUrl(name!, version!, comp.type_name)}
                          alt=""
                          style={{ width: 32, height: 32, filter: "var(--diagram-filter)" }}
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            img.style.display = "none";
                            const fallback = document.createElement("span");
                            fallback.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="32" height="32" fill="var(--color-text-muted)"><path d="M8.878.392a1.75 1.75 0 0 0-1.756 0l-5.25 3.045A1.75 1.75 0 0 0 1 4.951v6.098c0 .624.332 1.2.872 1.514l5.25 3.045a1.75 1.75 0 0 0 1.756 0l5.25-3.045c.54-.313.872-.89.872-1.514V4.951c0-.624-.332-1.2-.872-1.514ZM7.875 1.69a.25.25 0 0 1 .25 0l4.63 2.685L8 7.133 3.245 4.375ZM2.5 5.677l5 2.9v5.765l-4.63-2.685a.25.25 0 0 1-.124-.216L2.5 5.677Zm6.5 8.665V8.578l5-2.9v5.764a.25.25 0 0 1-.124.216L8.5 14.342Z"></path></svg>`;
                            img.parentNode?.appendChild(fallback);
                          }}
                        />
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
    </PageWrap>
  );
};

export default ClassDetailPage;
