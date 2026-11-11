// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CpuIcon,
  DatabaseIcon,
  FileCodeIcon,
  FileIcon,
  GlobeIcon,
  PackageIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  getArtifactViewers,
  getClassDetail,
  getClasses,
  getJobStatus,
  getLibraryDetail,
  getLibraryVersions,
  getPackageCollaborators,
  getPackageDependents,
  getPackageStats,
  getPackument,
  getPendingPackageTransfers,
  type ArtifactViewerInfo,
  type ClassDetail,
  type ClassSummary,
  type JobInfo,
  type Library,
  type LibraryVersion,
  type NpmPackument,
  type NpmVersionManifest,
  type PackageCollaborator,
  type PackageDependent,
  type PackageStats,
  type PendingPackageTransfer,
} from "../../../api";
import {
  getLinkedPackageStudies,
  type LinkedStudyJobItemPayload,
  type StudyDefinitionPayload,
} from "../../../api/compute";
import { buildClassTree, filterClassTree } from "../../../components/classTreeUtils";
import { sortVersionsDescending } from "../../../util/semver";
import { classifyArtifactDomain, type PolyglotDomain } from "../types";

export interface DomainMeta {
  id: PolyglotDomain;
  label: string;
  icon: React.ComponentType<{ size?: number | undefined }>;
  count: number;
  color: string;
}

export function usePackageData(
  name: string | undefined,
  version: string | undefined,
  user: { id: number; username: string; isAdmin?: boolean } | null,
  treeSearchFilter: string,
  artifactTabDomainFilter: PolyglotDomain,
) {
  const [rootClass, setRootClass] = useState<ClassDetail | null>(null);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [packument, setPackument] = useState<NpmPackument | null>(null);
  const [artifactViewers, setArtifactViewers] = useState<ArtifactViewerInfo[]>([]);
  const [packageStats, setPackageStats] = useState<PackageStats | null>(null);
  const [dependents, setDependents] = useState<PackageDependent[]>([]);
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
  const [libraryDetail, setLibraryDetail] = useState<LibraryVersion | null>(null);
  const [libraryVersions, setLibraryVersions] = useState<Library | null>(null);
  const [collaborators, setCollaborators] = useState<PackageCollaborator[]>([]);
  const [canManageServer, setCanManageServer] = useState(false);
  const [pendingTransfers, setPendingTransfers] = useState<PendingPackageTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const jobStatus = jobInfo?.status;

  const rootClassName = useMemo(() => {
    if (!name) return "";
    return name.includes("/") ? name.split("/")[1]! : name;
  }, [name]);

  const fetchData = useCallback(async () => {
    if (!name || !version) return;
    try {
      const [
        rootCls,
        classList,
        npmData,
        viewers,
        stats,
        depData,
        libDetail,
        collabData,
        transfers,
        linkedData,
        libVersions,
      ] = await Promise.all([
        getClassDetail(name, version, name)
          .catch(() => (rootClassName !== name ? getClassDetail(name, version, rootClassName) : null))
          .catch(() => null),
        getClasses(name, version).catch(() => []),
        getPackument(name).catch(() => null),
        getArtifactViewers(name, version).catch(() => []),
        getPackageStats(name, 30).catch(() => null),
        getPackageDependents(name).catch(() => null),
        getLibraryDetail(name, version).catch(() => null),
        getPackageCollaborators(name).catch(() => null),
        user ? getPendingPackageTransfers().catch(() => []) : Promise.resolve([]),
        getLinkedPackageStudies({ package: name, version }).catch(() => ({
          bundledStudies: [],
          linkedTemplates: [],
          compatibleTemplates: [],
          linkedJobs: [],
        })),
        getLibraryVersions(name).catch(() => null),
      ]);
      setRootClass(rootCls);
      setClasses(classList);
      setPackument(npmData);
      setArtifactViewers(viewers);
      setPackageStats(stats);
      setDependents(depData?.dependents || []);
      setLinkedStudies(linkedData);
      setLibraryDetail(libDetail);
      setLibraryVersions(libVersions);
      setCollaborators(collabData?.collaborators || []);
      setCanManageServer(Boolean(libDetail?.canManage || collabData?.canManage));
      setPendingTransfers(transfers.filter((t) => t.package_name === name));
      if (classList && classList.length > 0) {
        setJobInfo((prev) =>
          !prev || prev.status === "failed" ? { status: "completed", classesProcessed: classList.length } : prev,
        );
      }
    } catch (err) {
      setError("Failed to load artifact details");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [name, version, rootClassName, user]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Job polling
  useEffect(() => {
    if (!name || !version || jobStatus === "completed" || jobStatus === "failed") return;

    const checkStatus = async () => {
      try {
        const status = await getJobStatus(name, version);
        setJobInfo((prev) => {
          if (
            status.status === "completed" &&
            (prev?.status === "pending" || prev?.status === "processing" || prev?.status === "running")
          ) {
            fetchData();
          }
          return status;
        });
      } catch (err: unknown) {
        const error = err as { response?: { status?: number | undefined } | undefined };
        if (error?.response?.status === 404) {
          setJobInfo((prev) => {
            if (prev?.status === "completed" || classes.length > 0) {
              return { status: "completed", classesProcessed: classes.length };
            }
            return { status: "failed" };
          });
        } else {
          console.error("Failed to check job status", err);
        }
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [name, version, jobStatus, classes.length, fetchData]);

  // Derived data from packument & library
  const currentManifest: NpmVersionManifest | null =
    packument && version ? (packument.versions[version] ?? null) : null;

  const rawVersions = useMemo(() => {
    if (packument && Object.keys(packument.versions).length > 0) {
      return Object.keys(packument.versions);
    }
    if (libraryVersions?.versions && libraryVersions.versions.length > 0) {
      return libraryVersions.versions;
    }
    if (libraryDetail?.version) {
      return [libraryDetail.version];
    }
    if (version) {
      return [version];
    }
    return [];
  }, [packument, libraryVersions, libraryDetail, version]);

  const versionList = useMemo(() => {
    return sortVersionsDescending(Array.from(new Set(rawVersions)));
  }, [rawVersions]);

  const latestVersion = useMemo(() => {
    const distTagLatest = packument?.["dist-tags"]?.["latest"];
    if (distTagLatest && versionList.includes(distTagLatest)) {
      return distTagLatest;
    }
    return versionList[0] || version || "";
  }, [packument, versionList, version]);
  const artifacts = currentManifest?.modelscript?.artifacts ?? [];
  const dependencies = currentManifest?.dependencies ?? {};
  const publishedAt = libraryDetail?.publishedAt ?? packument?.time?.[version ?? ""] ?? packument?.time?.modified ?? "";
  const contentHash = libraryDetail?.contentHash ?? currentManifest?.dist?.shasum ?? null;
  const packageSignature = libraryDetail?.signature ?? null;
  const packageOwner = libraryDetail?.author ?? (name?.startsWith("@") ? name.split("/")[0]?.slice(1) : null);
  const oidcRepository = (libraryDetail as any)?.oidcRepository ?? null;
  const oidcWorkflow = (libraryDetail as any)?.oidcWorkflowRef ?? null;
  const oidcIssuer = (libraryDetail as any)?.oidcIssuer ?? null;
  const vulnerabilityCount = (libraryDetail as any)?.vulnerabilitiesCount ?? 0;
  const vulnerabilities = (libraryDetail as any)?.vulnerabilities ?? [];

  const canManage = useMemo(() => {
    if (!user) return false;
    if (canManageServer || user.isAdmin) return true;
    if (packageOwner && packageOwner === user.username) return true;
    if (name?.startsWith(`@${user.username}/`)) return true;
    return collaborators.some(
      (c) => c.username === user.username && (c.permission === "admin" || c.permission === "write"),
    );
  }, [user, canManageServer, packageOwner, name, collaborators]);

  const installCmd = `msx install ${name}`;

  const tree = useMemo(
    () => (name ? buildClassTree(classes, rootClassName || name) : []),
    [classes, name, rootClassName],
  );
  const filteredTree = useMemo(() => filterClassTree(tree, treeSearchFilter), [tree, treeSearchFilter]);

  const sysmlArtifacts = useMemo(
    () => artifactViewers.filter((av) => classifyArtifactDomain(av) === "sysml2"),
    [artifactViewers],
  );
  const cadArtifacts = useMemo(
    () => artifactViewers.filter((av) => classifyArtifactDomain(av) === "cad"),
    [artifactViewers],
  );
  const datasetArtifacts = useMemo(
    () => artifactViewers.filter((av) => classifyArtifactDomain(av) === "dataset"),
    [artifactViewers],
  );
  const fmuArtifacts = useMemo(
    () => artifactViewers.filter((av) => classifyArtifactDomain(av) === "fmu"),
    [artifactViewers],
  );
  const otherArtifacts = useMemo(
    () =>
      artifactViewers.filter(
        (av) =>
          !sysmlArtifacts.includes(av) &&
          !cadArtifacts.includes(av) &&
          !datasetArtifacts.includes(av) &&
          !fmuArtifacts.includes(av),
      ),
    [artifactViewers, sysmlArtifacts, cadArtifacts, datasetArtifacts, fmuArtifacts],
  );

  const filterArtifactList = useCallback(
    (list: ArtifactViewerInfo[]) => {
      if (!treeSearchFilter.trim()) return list;
      const q = treeSearchFilter.trim().toLowerCase();
      return list.filter(
        (av) =>
          av.path.toLowerCase().includes(q) ||
          av.displayName.toLowerCase().includes(q) ||
          av.type.toLowerCase().includes(q),
      );
    },
    [treeSearchFilter],
  );

  const filteredSysml = useMemo(() => filterArtifactList(sysmlArtifacts), [filterArtifactList, sysmlArtifacts]);
  const filteredCad = useMemo(() => filterArtifactList(cadArtifacts), [filterArtifactList, cadArtifacts]);
  const filteredDatasets = useMemo(() => filterArtifactList(datasetArtifacts), [filterArtifactList, datasetArtifacts]);
  const filteredFmu = useMemo(() => filterArtifactList(fmuArtifacts), [filterArtifactList, fmuArtifacts]);
  const filteredOther = useMemo(() => filterArtifactList(otherArtifacts), [filterArtifactList, otherArtifacts]);

  const availableDomains = useMemo(() => {
    const list: DomainMeta[] = [];
    const mCount = classes.length;
    const sCount = sysmlArtifacts.length;
    const cCount = cadArtifacts.length;
    const dCount = datasetArtifacts.length;
    const fCount = fmuArtifacts.length;
    const oCount = otherArtifacts.length;
    const totalCount = mCount + artifactViewers.length;

    const domainTypesPresent =
      (mCount > 0 ? 1 : 0) + (sCount > 0 ? 1 : 0) + (cCount > 0 ? 1 : 0) + (dCount > 0 ? 1 : 0) + (fCount > 0 ? 1 : 0);

    if (domainTypesPresent > 1 || totalCount > 0) {
      list.push({
        id: "all",
        label: "All",
        icon: GlobeIcon,
        count: totalCount,
        color: "var(--domain-core)",
      });
    }
    if (mCount > 0) {
      list.push({ id: "modelica", label: "Modelica", icon: FileCodeIcon, count: mCount, color: "var(--domain-core)" });
    }
    if (sCount > 0) {
      list.push({ id: "sysml2", label: "SysML v2", icon: WorkflowIcon, count: sCount, color: "var(--domain-core)" });
    }
    if (cCount > 0) {
      list.push({ id: "cad", label: "3D CAD", icon: PackageIcon, count: cCount, color: "var(--domain-cad)" });
    }
    if (dCount > 0) {
      list.push({ id: "dataset", label: "Datasets", icon: DatabaseIcon, count: dCount, color: "var(--domain-fluid)" });
    }
    if (fCount > 0) {
      list.push({ id: "fmu", label: "FMUs", icon: CpuIcon, count: fCount, color: "var(--domain-aero)" });
    }
    if (oCount > 0 && domainTypesPresent > 1) {
      list.push({ id: "other", label: "Files", icon: FileIcon, count: oCount, color: "var(--ms-text-3)" });
    }
    return list;
  }, [
    classes.length,
    sysmlArtifacts.length,
    cadArtifacts.length,
    datasetArtifacts.length,
    fmuArtifacts.length,
    otherArtifacts.length,
    artifactViewers.length,
  ]);

  const displayedArtifactViewers = useMemo(() => {
    if (artifactTabDomainFilter === "all") return artifactViewers;
    return artifactViewers.filter((av) => classifyArtifactDomain(av) === artifactTabDomainFilter);
  }, [artifactViewers, artifactTabDomainFilter]);

  const isCurrentYanked = Boolean(libraryDetail?.isYanked || currentManifest?.yanked || currentManifest?.is_yanked);
  const currentYankReason =
    libraryDetail?.yankReason ??
    (typeof currentManifest?.yanked === "string"
      ? currentManifest.yanked
      : (currentManifest?.yank_reason as string | undefined));
  const isCurrentDeprecated = Boolean(libraryDetail?.isDeprecated || currentManifest?.deprecated);
  const currentDeprecateReason =
    libraryDetail?.deprecationReason ??
    (typeof currentManifest?.deprecated === "string" ? currentManifest.deprecated : null);

  const description = libraryDetail?.description ?? packument?.description ?? rootClass?.description ?? null;

  return {
    rootClassName,
    rootClass,
    classes,
    packument,
    artifactViewers,
    packageStats,
    dependents,
    linkedStudies,
    libraryDetail,
    collaborators,
    pendingTransfers,
    loading,
    error,
    jobInfo,
    jobStatus,
    fetchData,
    currentManifest,
    versionList,
    latestVersion,
    artifacts,
    dependencies,
    publishedAt,
    contentHash,
    packageSignature,
    packageOwner,
    canManage,
    installCmd,
    oidcRepository,
    oidcWorkflow,
    oidcIssuer,
    vulnerabilityCount,
    vulnerabilities,
    tree,
    filteredTree,
    filteredSysml,
    filteredCad,
    filteredDatasets,
    filteredFmu,
    filteredOther,
    availableDomains,
    displayedArtifactViewers,
    isCurrentYanked,
    currentYankReason,
    isCurrentDeprecated,
    currentDeprecateReason,
    description,
  };
}
