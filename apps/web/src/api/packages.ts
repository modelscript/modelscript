// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { encodePackagePath } from "../util/url";
import { api } from "./client";

export interface Library {
  name: string;
  versions: string[];
}

export interface LibraryVersion {
  name: string;
  version: string;
  description: string | null;
  modelicaVersion: string | null;
  size: number;
  contentHash?: string | undefined;
  signature?: string | undefined;
  publishedAt?: string | undefined;
  isDeprecated?: boolean | undefined;
  deprecationReason?: string | null | undefined;
  isYanked?: boolean | undefined;
  yankReason?: string | null | undefined;
  yankedAt?: string | null | undefined;
  canManage?: boolean | undefined;
}

export type CollaboratorPermission = "admin" | "write" | "read";

export interface PackageCollaborator {
  id?: number | undefined;
  library_name: string;
  user_id: number;
  username: string;
  permission: CollaboratorPermission;
  created_at?: string | undefined;
}

export interface PendingPackageTransfer {
  id: number;
  package_name: string;
  from_user_id: number;
  to_user_id: number;
  from_username: string;
  to_username: string;
  status: string;
  created_at: string;
}

export interface PackageStats {
  name: string;
  totalDownloads: number;
  daily: { date: string; downloads: number }[];
  versionBreakdown: Record<string, number>;
}

export interface ClassSummary {
  class_name: string;
  class_kind: string;
  description: string | null;
}

export interface Component {
  component_name: string;
  type_name: string;
  description: string | null;
  causality: string | null;
  variability: string | null;
  modifiers: { modifier_name: string; modifier_value: string | null }[];
}

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface JobInfo {
  status: JobStatus;
  error?: string | undefined;
  logs?: string[] | undefined;
}

export interface ClassDetail {
  classKind: string;
  description: string | null;
  documentation: string | null;
  extends: string[];
  components: Component[];
  sourceFile?: string | null | undefined;
  sourceCode?: string | null | undefined;
  equations?: string[] | undefined;
  sysmlConfig?: Record<string, unknown> | undefined;
  cadResourceUrl?: string | undefined;
}

export interface LibraryListItem {
  name: string;
  versions: string[];
  latestVersion: string | null;
  description?: string | undefined;
  license?: string | undefined;
  author?: string | undefined;
  scope?: string | undefined;
  publishedAt?: string | undefined;
  totalDownloads?: number | undefined;
  downloads30d?: number | undefined;
  isDeprecated?: boolean | undefined;
  deprecationReason?: string | null | undefined;
  isYanked?: boolean | undefined;
  domains?: string[] | undefined;
  jobStatus?:
    | {
        status: JobStatus;
        classesProcessed?: number | undefined;
        error?: string | undefined;
      }
    | null
    | undefined;
}

export const getLibraries = async (q?: string) => {
  try {
    const { data } = await api.get<{ packages: LibraryListItem[] }>("/libraries", { params: { q } });
    if (data.packages && data.packages.length > 0) {
      return data.packages;
    }
  } catch (err) {
    if (!import.meta.env.DEV) throw err;
  }

  // Fallback to local standard libraries in development
  const stdLibs: LibraryListItem[] = [
    {
      name: "Modelica",
      versions: ["4.1.0"],
      latestVersion: "4.1.0",
      description: "Modelica Standard Library",
      license: "BSD-3-Clause",
      domains: ["modelica"],
    },
    {
      name: "SysML",
      versions: ["2026.3.0"],
      latestVersion: "2026.3.0",
      description: "SysML v2 Standard Library",
      license: "OMG-SysML-2.0",
      domains: ["sysml2"],
    },
  ];

  if (q) {
    return stdLibs.filter((lib) => lib.name.toLowerCase().includes(q.toLowerCase()));
  }
  return stdLibs;
};

export const getLibraryVersions = async (name: string) => {
  const { data } = await api.get<Library>(`/libraries/${encodePackagePath(name)}`);
  return data;
};

export const getLibraryDetail = async (name: string, version: string) => {
  const { data } = await api.get<LibraryVersion>(
    `/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}`,
  );
  return data;
};

export const getClasses = async (name: string, version: string, kind?: string, q?: string) => {
  const { data } = await api.get<{ classes: ClassSummary[] }>(
    `/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/classes`,
    {
      params: { kind, q },
    },
  );
  return data?.classes || [];
};

export const getClassDetail = async (name: string, version: string, className: string) => {
  const { data } = await api.get<ClassDetail>(
    `/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/classes/${encodeURIComponent(className)}`,
  );
  return data;
};

export const getJobStatus = async (name: string, version: string) => {
  const { data } = await api.get<JobInfo & { name: string; version: string }>(
    `/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/status`,
  );
  return data;
};

export const getIconUrl = (name: string, version: string, className: string) =>
  `/api/v1/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/classes/${encodeURIComponent(className)}/icon.svg`;

export const getDiagramUrl = (name: string, version: string, className: string) =>
  `/api/v1/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/classes/${encodeURIComponent(className)}/diagram.svg`;

export const getPackageDownloadUrl = (name: string, version: string) =>
  `/api/v1/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/download`;

export const getPackageAasxExportUrl = (name: string, version: string, variant?: string) =>
  `/api/v1/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/export/aasx${variant && variant !== "default" ? `?variant=${encodeURIComponent(variant)}` : ""}`;

export const getPackageOkhExportUrl = (name: string, version: string, variant?: string) =>
  `/api/v1/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/export/okh${variant && variant !== "default" ? `?variant=${encodeURIComponent(variant)}` : ""}`;

export const getPackageSalsaIndexUrl = (name: string, version: string) =>
  `/api/v1/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/salsa-index.db`;

export const getPackageStats = async (name: string, days = 30): Promise<PackageStats> => {
  const { data } = await api.get<PackageStats>(`/libraries/${encodePackagePath(name)}/stats`, { params: { days } });
  return data;
};

export const deprecatePackage = async (name: string, version: string, reason: string) => {
  const { data } = await api.post(`/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/deprecate`, {
    reason,
  });
  return data;
};

export const undeprecatePackage = async (name: string, version: string) => {
  const { data } = await api.delete(`/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/deprecate`);
  return data;
};

export const yankPackage = async (name: string, version: string, reason: string) => {
  const { data } = await api.post(`/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/yank`, {
    reason,
  });
  return data;
};

export const unyankPackage = async (name: string, version: string) => {
  const { data } = await api.post(`/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/unyank`);
  return data;
};

export const transferPackageOwnership = async (name: string, targetUsername: string) => {
  const { data } = await api.post(`/libraries/${encodePackagePath(name)}/transfer-ownership`, { targetUsername });
  return data;
};

export const acceptPackageTransfer = async (transferId: number) => {
  const { data } = await api.post(`/libraries/transfers/${transferId}/accept`);
  return data;
};

export const cancelPackageTransfer = async (transferId: number) => {
  const { data } = await api.post(`/libraries/transfers/${transferId}/cancel`);
  return data;
};

export const getPendingPackageTransfers = async (): Promise<PendingPackageTransfer[]> => {
  const { data } = await api.get<{ transfers: PendingPackageTransfer[] }>(`/libraries/transfers/pending`);
  return data.transfers || [];
};

export const getPackageCollaborators = async (
  name: string,
): Promise<{ package: string; collaborators: PackageCollaborator[]; canManage?: boolean | undefined }> => {
  const { data } = await api.get<{
    package: string;
    collaborators: PackageCollaborator[];
    canManage?: boolean | undefined;
  }>(`/libraries/${encodePackagePath(name)}/collaborators`);
  return data;
};

export const addPackageCollaborator = async (
  name: string,
  username: string,
  permission: CollaboratorPermission = "write",
) => {
  const { data } = await api.post(`/libraries/${encodePackagePath(name)}/collaborators`, {
    username,
    permission,
  });
  return data;
};

export const removePackageCollaborator = async (name: string, userId: number) => {
  const { data } = await api.delete(`/libraries/${encodePackagePath(name)}/collaborators/${userId}`);
  return data;
};

export const publishPackageArchive = async (
  name: string,
  version: string,
  file: File | Blob,
  options?: {
    tag?: string | undefined;
    description?: string | undefined;
    license?: string | undefined;
    contentHash?: string | undefined;
  },
) => {
  const formData = new FormData();
  formData.append("file", file);
  if (options?.tag) formData.append("tag", options.tag);
  if (options?.description) formData.append("description", options.description);
  if (options?.license) formData.append("license", options.license);
  if (options?.contentHash) formData.append("contentHash", options.contentHash);

  const headers: Record<string, string> = {};
  if (options?.contentHash) {
    headers["X-Content-SHA256"] = options.contentHash;
  }

  const { data } = await api.post(`/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}`, formData, {
    headers,
  });
  return data;
};

export const unpublishPackageRelease = async (name: string, version: string) => {
  const { data } = await api.delete(`/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}`);
  return data;
};

export interface PackageDependent {
  name: string;
  version: string;
  description: string | null;
}

export const getPackageDependents = async (
  name: string,
): Promise<{ name: string; count: number; dependents: PackageDependent[] }> => {
  const { data } = await api.get<{ name: string; count: number; dependents: PackageDependent[] }>(
    `/libraries/${encodePackagePath(name)}/dependents`,
  );
  return data;
};

/**
 * Rewrite `modelica://` URIs and relative asset links in documentation HTML / markdown:
 *
 * 1. Resource paths: `modelica://Modelica/Resources/Images/foo.png`
 *    → `/api/v1/libraries/Modelica/4.1.0/resources/Resources/Images/foo.png`
 *
 * 2. Class references: `modelica://Modelica.Electrical.Analog`
 *    → `/packages/Modelica/4.1.0/classes/Modelica.Electrical.Analog`
 *
 * 3. Relative image paths (when packageName provided):
 *    `<img src="./doc/arch.png">` or `![alt](./doc/arch.png)`
 *    → `/api/v1/libraries/Modelica/4.1.0/resources/doc/arch.png`
 */
export function rewriteModelicaUris(html: string, version: string, packageName?: string): string {
  if (!html) return "";

  // First pass: resource paths (modelica://LibName/path — contains a slash after lib name)
  let result = html.replace(/modelica:\/\/([^/\s"']+)\/([^"'\s>]+)/g, (_match, libName, resourcePath) => {
    const targetPkg =
      packageName && (packageName === libName || packageName.endsWith(`/${libName}`)) ? packageName : libName;
    return `/api/v1/libraries/${encodePackagePath(targetPkg)}/${version}/resources/${resourcePath}`;
  });

  // Second pass: class references (modelica://Lib.Class.Name — dotted name, no slash)
  result = result.replace(/modelica:\/\/([A-Za-z_][\w.]*)/g, (_match, className) => {
    const libName = className.split(".")[0];
    const targetPkg =
      packageName && (packageName === libName || packageName.endsWith(`/${libName}`)) ? packageName : libName;
    return `/packages/${targetPkg}/${version}/classes/${className}`;
  });

  // Third pass: relative image/asset paths
  if (packageName && version) {
    const encodedPkg = encodePackagePath(packageName);
    const encodedVer = encodeURIComponent(version);

    // Markdown images: ![alt](./path.png) or ![alt](path.png)
    result = result.replace(
      /(!\[[^\]]*\]\()(?!https?:\/\/|\/|data:|modelica:)(?:\.\/)?([^)\s]+)(\))/gi,
      (_match, prefix, relPath, suffix) => {
        return `${prefix}/api/v1/libraries/${encodedPkg}/${encodedVer}/resources/${relPath}${suffix}`;
      },
    );

    // HTML img tags: <img ... src="./path.png"> or src="path.png"
    result = result.replace(
      /(<img\b[^>]*?\bsrc=["'])(?!https?:\/\/|\/|data:|modelica:)(?:\.\/)?([^"'>\s]+)(["'])/gi,
      (_match, prefix, relPath, suffix) => {
        return `${prefix}/api/v1/libraries/${encodedPkg}/${encodedVer}/resources/${relPath}${suffix}`;
      },
    );
  }

  return result;
}

// ── npm registry API ────────────────────────────────────────────

export interface NpmPackument {
  _id: string;
  name: string;
  description?: string | null | undefined;
  "dist-tags": Record<string, string>;
  versions: Record<string, NpmVersionManifest>;
  time?: Record<string, string> | undefined;
  readme?: string | undefined;
  readmeFilename?: string | undefined;
  license?: string | null | undefined;
  homepage?: string | null | undefined;
  repository?: { type: string; url: string } | null | undefined;
}

export interface NpmVersionManifest {
  name: string;
  version: string;
  description?: string | undefined;
  dependencies?: Record<string, string> | undefined;
  devDependencies?: Record<string, string> | undefined;
  modelscript?:
    | {
        languages?: string[] | undefined;
        main?: string | undefined;
        modelicaVersion?: string | undefined;
        artifacts?: NpmArtifact[] | undefined;
        verification?:
          | {
              requirements?: string | undefined;
              results?: string | undefined;
            }
          | undefined;
      }
    | undefined;
  dist?:
    | {
        shasum: string;
        integrity?: string | undefined;
        tarball: string;
      }
    | undefined;
  license?: string | undefined;
  author?: { name?: string | undefined; email?: string | undefined; url?: string | undefined } | string | undefined;
  [key: string]: unknown;
}

export interface NpmArtifact {
  type: string;
  path: string;
  description?: string | undefined;
  fmiVersion?: string | undefined;
  platforms?: string[] | undefined;
  [key: string]: unknown;
}

export interface NpmSearchResult {
  objects: {
    package: {
      name: string;
      version: string;
      description: string | null;
      date: string;
      links?: Record<string, string> | undefined;
    };
  }[];
  total: number;
}

/**
 * Fetch the full npm packument for a package.
 */
export const getPackument = async (name: string): Promise<NpmPackument | null> => {
  try {
    const { data } = await api.get<NpmPackument>(`/npm/${encodeURIComponent(name)}`);
    if (typeof data !== "object" || !data || !data.versions) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
};

/**
 * Search the npm registry.
 */
export const searchRegistry = async (text: string, size = 20): Promise<NpmSearchResult> => {
  const { data } = await api.get<NpmSearchResult>("/npm/-/v1/search", {
    params: { text, size },
  });
  return data;
};

// ── Polyglot Package Version Diff ─────────────────────────────────

export interface VersionComparisonResult {
  versionDelta: { base: string; head: string };
  classes: {
    added: { name: string; kind: string; description: string | null }[];
    removed: { name: string; kind: string; description: string | null }[];
    modified: {
      name: string;
      kind: string;
      parameterChanges: { name: string; old: unknown; new: unknown; unit?: string | undefined }[];
    }[];
  };
  cadChanges: {
    file: string;
    status: "added" | "removed" | "modified" | "unchanged";
    volumeDeltaPercent?: number | undefined;
  }[];
  parityDrift: {
    className: string;
    parameter: string;
    oldUnit: string;
    newUnit: string;
  }[];
}

export const comparePackageVersions = async (
  name: string,
  base: string,
  head: string,
): Promise<VersionComparisonResult> => {
  const { data } = await api.get(`/libraries/${encodePackagePath(name)}/compare`, {
    params: { base, head },
  });
  return data;
};
