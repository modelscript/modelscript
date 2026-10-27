// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, LinkExternalIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ClassDetail, ClassSummary, JobStatus } from "../api";
import { getClassDetail, getClasses, getJobStatus } from "../api";
import Box from "../components/Box";
import {
  buildClassTree,
  categorizeClassComponents,
  type ClassDomain,
  classifyClassDomain,
  filterClassTree,
  resolveTypeTargetUrl,
} from "../components/classTreeUtils";
import { usePageTitle } from "../util/title";
import { resolvePackageParams } from "../util/url";
import {
  ClassDetailHeader,
  ClassEquationsTab,
  ClassOverviewTab,
  ClassParametersSection,
  ClassRightSidebar,
  ClassSourceTab,
  type ClassTabId,
  ClassTreeSidebar,
  ContentGrid,
  type DigitalThreadTwinInfo,
  GlassCard,
  MainContentWrap,
  PageWrap,
  TypeLink,
  TypeMono,
} from "./class-detail";

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
  const twinInfo: DigitalThreadTwinInfo | null = useMemo(() => {
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

  return (
    <PageWrap>
      {/* ── Left Sidebar (Classes) ── */}
      {allClasses.length > 0 && (
        <ClassTreeSidebar
          libraryName={name!}
          version={version!}
          activeClassName={className}
          treeSearch={treeSearch}
          setTreeSearch={setTreeSearch}
          domainFilter={domainFilter}
          setDomainFilter={setDomainFilter}
          domainCounts={domainCounts}
          filteredTree={filteredTree}
          hasMultipleDomains={hasMultipleDomains}
        />
      )}

      <MainContentWrap>
        {/* ── Header ── */}
        <ClassDetailHeader
          libraryName={name!}
          version={version!}
          className={className!}
          cls={cls}
          jobStatus={jobStatus}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          equationsCount={equations.length}
        />

        {/* ── Body ── */}
        <ContentGrid>
          {/* ── Main column ── */}
          <div style={{ minWidth: 0 }}>
            {activeTab === "overview" && (
              <ClassOverviewTab
                cls={cls}
                className={className!}
                libraryName={name!}
                version={version!}
                allClasses={allClasses}
                diagramLoaded={diagramLoaded}
                setDiagramLoaded={setDiagramLoaded}
                diagramError={diagramError}
                setDiagramError={setDiagramError}
                retryCount={retryCount}
                setRetryCount={setRetryCount}
                jobStatus={jobStatus}
                categorized={categorized}
                renderTypeCell={renderTypeCell}
              />
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
                  <ClassParametersSection
                    parameters={categorized.parameters}
                    connectors={categorized.connectors}
                    submodels={categorized.submodels}
                    renderTypeCell={renderTypeCell}
                    libraryName={name!}
                    version={version!}
                  />
                )}
              </>
            )}

            {activeTab === "equations" && <ClassEquationsTab equations={equations} />}

            {activeTab === "source" && (
              <ClassSourceTab sourceCode={cls.sourceCode} sourceFile={cls.sourceFile} className={className!} />
            )}
          </div>

          {/* ── Right Sidebar ── */}
          <ClassRightSidebar
            className={className!}
            libraryName={name!}
            version={version!}
            cls={cls}
            allClasses={allClasses}
            retryCount={retryCount}
            twinInfo={twinInfo}
            onSelectMember={(targetUrl) => {
              if (targetUrl && targetUrl.includes("/classes/")) {
                navigate(targetUrl);
              } else {
                setActiveTab("parameters");
              }
            }}
            onNavigate={(path) => navigate(path)}
          />
        </ContentGrid>
      </MainContentWrap>
    </PageWrap>
  );
};

export default ClassDetailPage;
