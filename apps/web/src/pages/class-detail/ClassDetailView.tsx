// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, LinkExternalIcon } from "@primer/octicons-react";
import { Button, Heading, Text } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ClassDetail, ClassSummary, JobStatus } from "../../api";
import { getClassDetail, getClasses, getJobStatus } from "../../api";
import {
  getLinkedPackageStudies,
  type LinkedStudyJobItemPayload,
  type StudyDefinitionPayload,
} from "../../api/compute";
import Box from "../../components/Box";
import {
  categorizeClassComponents,
  extractModelicaEquations,
  resolveTypeTargetUrl,
} from "../../components/classTreeUtils";
import { useFeatureFlag } from "../../FeatureFlagContext";
import { PackageStudiesTab } from "../package/tabs/PackageStudiesTab";
import { ClassEquationsTab, ClassSourceTab } from "./components/ClassCodeTabs";
import { ClassDetailHeader } from "./components/ClassDetailHeader";
import { ClassOverviewTab } from "./components/ClassOverviewTab";
import { ClassParametersSection } from "./components/ClassParametersSection";
import { ContentWrap, GlassCard, TypeLink, TypeMono } from "./styles";
import type { ClassTabId } from "./types";

export interface ClassDetailViewProps {
  name: string;
  version: string;
  className: string;
  allClasses?: ClassSummary[] | undefined;
  jobStatus?: JobStatus | null | undefined;
  treeCollapsed?: boolean | undefined;
  onToggleTreeCollapse?: (() => void) | undefined;
  onOpenLogs?: (() => void) | undefined;
}

export const ClassDetailView: React.FC<ClassDetailViewProps> = ({
  name,
  version,
  className,
  allClasses: propAllClasses,
  jobStatus: propJobStatus,
  treeCollapsed,
  onToggleTreeCollapse,
  onOpenLogs,
}) => {
  const navigate = useNavigate();
  const hasCae = useFeatureFlag("cae_cloud_solver");
  const [cls, setCls] = useState<ClassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDescription, setErrorDescription] = useState<string | null>(null);
  const [jobStatusState, setJobStatusState] = useState<JobStatus | null>(propJobStatus ?? null);
  const [retryCount, setRetryCount] = useState(0);
  const [diagramLoaded, setDiagramLoaded] = useState(false);
  const [diagramError, setDiagramError] = useState(false);
  const [allClasses, setAllClasses] = useState<ClassSummary[]>(propAllClasses || []);
  const [activeTab, setActiveTab] = useState<ClassTabId>("overview");
  const [linkedStudies, setLinkedStudies] = useState<{
    bundledStudies: (StudyDefinitionPayload & { dbId?: number | undefined })[];
    linkedTemplates: (StudyDefinitionPayload & { dbId?: number | undefined })[];
    compatibleTemplates: (StudyDefinitionPayload & { dbId?: number | undefined })[];
    linkedJobs: LinkedStudyJobItemPayload[];
  }>({
    bundledStudies: [],
    linkedTemplates: [],
    compatibleTemplates: [],
    linkedJobs: [],
  });

  useEffect(() => {
    if (propAllClasses && propAllClasses.length > 0) {
      setAllClasses(propAllClasses);
    }
  }, [propAllClasses]);

  useEffect(() => {
    if (propJobStatus !== undefined) {
      setJobStatusState(propJobStatus);
    }
  }, [propJobStatus]);

  const fetchLinkedClassStudies = useCallback(() => {
    if (!name || !version || !className) return;
    getLinkedPackageStudies({ package: name, version, model: className })
      .then(setLinkedStudies)
      .catch(() => {});
  }, [name, version, className]);

  // Reset tab & diagram state when navigating between classes
  useEffect(() => {
    setActiveTab("overview");
    setDiagramLoaded(false);
    setDiagramError(false);
    fetchLinkedClassStudies();
  }, [className, fetchLinkedClassStudies]);

  // Fetch all classes if not provided via props
  useEffect(() => {
    if (!name || !version || (propAllClasses && propAllClasses.length > 0)) return;
    getClasses(name, version)
      .then(setAllClasses)
      .catch(() => {});
  }, [name, version, propAllClasses]);

  const categorized = useMemo(() => {
    if (!cls) return { parameters: [], connectors: [], submodels: [] };
    return categorizeClassComponents(cls.components || []);
  }, [cls]);

  const equations = useMemo(() => {
    if (cls?.equations && cls.equations.length > 0) {
      if (cls.equations.length === 1 && cls.sourceCode && (cls.sourceCode.match(/\bconnect\s*\(/g)?.length || 0) > 1) {
        return extractModelicaEquations(cls.sourceCode);
      }
      return cls.equations;
    }
    if (cls?.sourceCode) {
      return extractModelicaEquations(cls.sourceCode);
    }
    return [];
  }, [cls]);

  const fetchClassDetail = useCallback(async () => {
    if (!name || !version || !className) return;
    if (name === "Modelica" && (className === "Demo" || className.startsWith("Demo."))) {
      navigate(`/packages/${name}/${version}`, { replace: true });
      return;
    }
    try {
      setLoading(true);
      const data = await getClassDetail(name, version, className);
      setCls(data);
      setError(null);
      setErrorDescription(null);
    } catch (err: unknown) {
      const axiosError = err as {
        response?: { status?: number | undefined; data?: { error?: string } | string | undefined } | undefined;
        message?: string | undefined;
      };
      const status = axiosError?.response?.status;
      const respData = axiosError?.response?.data;
      const serverMsg =
        typeof respData === "object" && respData && "error" in respData && typeof respData.error === "string"
          ? respData.error
          : typeof respData === "string"
            ? respData
            : undefined;

      if (status === 429) {
        setError("Too many requests");
        setErrorDescription(serverMsg || "Rate limit reached. Please wait a few seconds and try again.");
      } else if (status === 404) {
        setError("Class not found");
        setErrorDescription(serverMsg || `The class "${className}" was not found in ${name}@${version}.`);
      } else {
        setError("Failed to load class details");
        setErrorDescription(
          serverMsg ||
            axiosError?.message ||
            "The class may not exist, is still being processed, or the server is unavailable.",
        );
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [name, version, className, navigate]);

  useEffect(() => {
    fetchClassDetail();
  }, [fetchClassDetail]);

  useEffect(() => {
    if (!name || !version || jobStatusState === "completed" || jobStatusState === "failed") return;

    const checkStatus = async () => {
      try {
        const status = await getJobStatus(name, version);
        setJobStatusState((prev) => {
          if (status.status === "completed" && (prev === "pending" || prev === "processing")) {
            fetchClassDetail();
          }
          return status.status;
        });
      } catch (err: unknown) {
        const errorObj = err as { response?: { status?: number | undefined } | undefined };
        if (errorObj?.response?.status === 404) {
          setJobStatusState("failed");
        } else {
          console.error("Failed to check job status", err);
        }
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [name, version, jobStatusState, fetchClassDetail]);

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
      <Box p={4} display="flex" flexDirection="column" gap={3}>
        <Box mb={2}>
          <div className="skeleton" style={{ width: "260px", height: "18px", borderRadius: "4px" }} />
        </Box>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "16px",
            marginBottom: "12px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <div className="skeleton" style={{ width: "320px", height: "32px", borderRadius: "6px" }} />
              <div className="skeleton" style={{ width: "80px", height: "22px", borderRadius: "6px" }} />
            </div>
            <div className="skeleton" style={{ width: "80%", height: "16px", borderRadius: "4px" }} />
            <div className="skeleton" style={{ width: "100%", height: "36px", borderRadius: "8px" }} />
          </div>
          <div className="skeleton" style={{ width: "72px", height: "72px", borderRadius: "14px", flexShrink: 0 }} />
        </div>
        <ContentWrap style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="skeleton" style={{ width: "100%", height: "260px", borderRadius: "12px" }} />
            <div className="skeleton" style={{ width: "100%", height: "200px", borderRadius: "12px" }} />
          </div>
        </ContentWrap>
      </Box>
    );
  }

  if (error || !cls) {
    return (
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
        <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 15, margin: 0, maxWidth: 440 }}>
          {errorDescription || "The class may not exist, is still being processed, or the server is unavailable."}
        </Text>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
          <Button onClick={() => fetchClassDetail()}>Try Again</Button>
          {name && version && (
            <TypeLink to={`/packages/${name}/${version}`} style={{ fontSize: 14 }}>
              Back to {name}@{version}
            </TypeLink>
          )}
        </div>
      </Box>
    );
  }

  return (
    <>
      {/* ── Header ── */}
      <ClassDetailHeader
        libraryName={name}
        version={version}
        className={className}
        cls={cls}
        jobStatus={jobStatusState}
        activeTab={activeTab === "studies" && !hasCae ? "overview" : activeTab}
        setActiveTab={(tab) => {
          if (tab === "studies" && !hasCae) return;
          setActiveTab(tab);
        }}
        hasCae={hasCae}
        equationsCount={equations.length}
        studiesCount={
          (linkedStudies.bundledStudies?.length || 0) +
          (linkedStudies.linkedTemplates?.length || 0) +
          (linkedStudies.linkedJobs?.length || 0)
        }
        treeCollapsed={treeCollapsed}
        onToggleTreeCollapse={onToggleTreeCollapse}
        onOpenLogs={onOpenLogs}
        allClasses={allClasses}
      />

      {/* ── Body ── */}
      <ContentWrap>
        {activeTab === "overview" && (
          <ClassOverviewTab
            cls={cls}
            className={className}
            libraryName={name}
            version={version}
            allClasses={allClasses}
            diagramLoaded={diagramLoaded}
            setDiagramLoaded={setDiagramLoaded}
            diagramError={diagramError}
            setDiagramError={setDiagramError}
            retryCount={retryCount}
            setRetryCount={setRetryCount}
            jobStatus={jobStatusState}
            categorized={categorized}
            renderTypeCell={renderTypeCell}
            onViewParameters={() => setActiveTab("parameters")}
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
                libraryName={name}
                version={version}
              />
            )}
          </>
        )}

        {activeTab === "equations" && (
          <ClassEquationsTab equations={equations} className={className} components={cls.components} cls={cls} />
        )}

        {hasCae && activeTab === "studies" && (
          <PackageStudiesTab
            name={name}
            version={version}
            rootClassName={className}
            targetModelFilter={className}
            bundledStudies={linkedStudies.bundledStudies}
            linkedTemplates={linkedStudies.linkedTemplates}
            compatibleTemplates={linkedStudies.compatibleTemplates}
            linkedJobs={linkedStudies.linkedJobs}
            onRefresh={fetchLinkedClassStudies}
          />
        )}

        {activeTab === "source" && (
          <ClassSourceTab sourceCode={cls.sourceCode} sourceFile={cls.sourceFile} className={className} />
        )}
      </ContentWrap>
    </>
  );
};
