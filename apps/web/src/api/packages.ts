// SPDX-License-Identifier: AGPL-3.0-or-later

import { getStdlibCatalog } from "@modelscript/exchange/catalog";
import { encodePackagePath } from "../util/url";
import { api } from "./client";

export interface Library {
  name: string;
  versions: string[];
}

export interface DataPackageSchemaFieldSummary {
  name: string;
  type: string;
  unit?: string | undefined;
  description?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  mean?: number | undefined;
}

export interface DataPackageResourceSummary {
  name: string;
  path?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  format?: string | undefined;
  mediatype?: string | undefined;
  bytes?: number | undefined;
  hash?: string | undefined;
  storage?: "inline" | "cas" | "s3" | "http" | undefined;
  rowCount?: number | undefined;
  schema?: { fields: DataPackageSchemaFieldSummary[] } | undefined;
}

export interface DataPackageLockEntrySummary {
  name: string;
  version: string;
  resolved?: string | undefined;
  integrity: string;
  dependencies?: Record<string, string> | undefined;
  resources?:
    | {
        name: string;
        path: string;
        hash: string;
        bytes?: number | undefined;
        storage?: "inline" | "cas" | "s3" | "http" | undefined;
      }[]
    | undefined;
}

export interface DataPackageLockJsonSummary {
  lockfileVersion: 1;
  profile: "engineering-data-package-lock";
  name: string;
  version: string;
  generatedAt: string;
  engine?: { modelscript: string; compilerTarget?: string | undefined; solver?: string | undefined } | undefined;
  packages: Record<string, DataPackageLockEntrySummary>;
}

export interface LibraryVersion {
  name: string;
  version: string;
  description: string | null;
  modelicaVersion: string | null;
  size: number;
  license?: string | null | undefined;
  author?: string | undefined;
  profile?: string | undefined;
  resourcesCount?: number | undefined;
  resources?: DataPackageResourceSummary[] | undefined;
  salsaIndexed?: boolean | undefined;
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

export type LibraryDetail = LibraryVersion;

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

export type JobStatus = "pending" | "processing" | "running" | "completed" | "failed";

export interface JobInfo {
  id?: string | number | undefined;
  status: JobStatus;
  error?: string | undefined;
  logs?: string[] | undefined;
}

export interface ClassDetail {
  className?: string | undefined;
  classKind: string;
  description: string | null;
  documentation: string | null;
  extends: string[];
  baseClasses?: string[] | undefined;
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
  downloads7d?: number | undefined;
  dependentsCount?: number | undefined;
  recommendationScore?: number | undefined;
  recommendationReason?: string | undefined;
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
  [key: string]: any;
}

const isDevMode = (): boolean =>
  Boolean(
    (typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) ||
    (typeof process !== "undefined" && process.env?.["NODE_ENV"] !== "production"),
  );

export const getLibraries = async (q?: string, sort?: string, author?: string) => {
  try {
    const params: { q?: string; sort?: string; author?: string } = { q };
    if (sort !== undefined) params.sort = sort;
    if (author !== undefined) params.author = author;
    const { data } = await api.get<{ packages: LibraryListItem[] }>("/libraries", { params });
    if (Array.isArray(data.packages)) {
      return data.packages;
    }
  } catch (err) {
    if (!isDevMode()) throw err;
  }

  // Fallback to local standard libraries from catalog in development
  const groupedLibs = new Map<string, LibraryListItem>();
  for (const lib of getStdlibCatalog().libraries) {
    const existing = groupedLibs.get(lib.packageName);
    if (!existing) {
      groupedLibs.set(lib.packageName, {
        name: lib.packageName,
        versions: [lib.version],
        latestVersion: lib.version,
        description: lib.description,
        license: lib.license,
        domains: [lib.domain],
      });
    } else {
      if (!existing.versions.includes(lib.version)) {
        existing.versions.push(lib.version);
      }
      if (lib.domain && !existing.domains?.includes(lib.domain)) {
        existing.domains?.push(lib.domain);
      }
    }
  }
  let stdLibs: LibraryListItem[] = Array.from(groupedLibs.values());

  if (author) {
    const target = author.replace(/^@/, "").toLowerCase();
    stdLibs = stdLibs.filter((lib) => {
      const auth = lib.author ? lib.author.replace(/^@/, "").toLowerCase() : undefined;
      const scp = lib.scope ? lib.scope.replace(/^@/, "").toLowerCase() : undefined;
      return auth === target || scp === target;
    });
  }

  if (q) {
    return stdLibs.filter((lib) => lib.name.toLowerCase().includes(q.toLowerCase()));
  }
  return stdLibs;
};

export const getLibraryVersions = async (name: string): Promise<Library> => {
  try {
    const { data } = await api.get<Library>(`/libraries/${encodePackagePath(name)}`);
    return data;
  } catch (err) {
    if (!isDevMode()) throw err;
    const matching = getStdlibCatalog().libraries.filter(
      (lib) => lib.packageName === name || `@${lib.domain}/${lib.packageName}` === name,
    );
    if (matching.length > 0) {
      const versions = Array.from(new Set(matching.map((lib) => lib.version)));
      return {
        name,
        versions,
      };
    }
    throw err;
  }
};

export const getLibraryDetail = async (name: string, version: string): Promise<LibraryVersion> => {
  try {
    const { data } = await api.get<LibraryVersion>(
      `/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}`,
    );
    return data;
  } catch (err) {
    if (!isDevMode()) throw err;
    const stdLib = getStdlibCatalog().libraries.find(
      (lib) =>
        (lib.packageName === name || `@${lib.domain}/${lib.packageName}` === name) &&
        (!version || lib.version === version),
    );
    if (stdLib) {
      return {
        name: stdLib.packageName,
        version: stdLib.version,
        description: stdLib.description,
        modelicaVersion: stdLib.language === "modelica" ? "3.6" : null,
        size: 0,
        license: stdLib.license,
      };
    }
    throw err;
  }
};

const classesCache = new Map<string, Promise<ClassSummary[]> | ClassSummary[]>();
const classDetailCache = new Map<string, Promise<ClassDetail> | ClassDetail>();

export function clearPackageClassesCache(name?: string, version?: string): void {
  if (name && version) {
    classesCache.delete(`${name}@${version}`);
  } else {
    classesCache.clear();
  }
}

export const getClasses = async (name: string, version: string, kind?: string, q?: string): Promise<ClassSummary[]> => {
  const cacheKey = !kind && !q ? `${name}@${version}` : null;
  if (cacheKey && classesCache.has(cacheKey)) {
    return classesCache.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const { data } = await api.get<{ classes: ClassSummary[] }>(
        `/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/classes`,
        {
          params: { kind, q },
        },
      );
      const result = data?.classes || [];
      if (cacheKey) classesCache.set(cacheKey, result);
      return result;
    } catch (err) {
      if (cacheKey) classesCache.delete(cacheKey);
      if (!isDevMode()) throw err;
      return [];
    }
  })();

  if (cacheKey) classesCache.set(cacheKey, promise);
  return promise;
};

export const getClassDetail = async (name: string, version: string, className: string): Promise<ClassDetail> => {
  const cacheKey = `${name}@${version}@${className}`;
  if (classDetailCache.has(cacheKey)) {
    return classDetailCache.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const { data } = await api.get<ClassDetail>(
        `/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/classes/${encodeURIComponent(className)}`,
      );
      classDetailCache.set(cacheKey, data);
      return data;
    } catch (err) {
      classDetailCache.delete(cacheKey);
      throw err;
    }
  })();

  classDetailCache.set(cacheKey, promise);
  return promise;
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

export const getPackageDataPackageExportUrl = (name: string, version: string, variant?: string) =>
  `/api/v1/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/export/datapackage${variant && variant !== "default" ? `?variant=${encodeURIComponent(variant)}` : ""}`;

export const getPackageLockfileExportUrl = (name: string, version: string) =>
  `/api/v1/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/export/lockfile`;

export const getPackageLockfile = async (name: string, version: string): Promise<DataPackageLockJsonSummary | null> => {
  try {
    const { data } = await api.get<DataPackageLockJsonSummary>(
      `/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/lockfile`,
    );
    return data;
  } catch {
    return null;
  }
};

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

export const acceptPackageTransfer = async (transferIdOrName: number | string, maybeTransferId?: number) => {
  const transferId = typeof transferIdOrName === "number" ? transferIdOrName : maybeTransferId;
  const { data } = await api.post(`/libraries/transfers/${transferId}/accept`);
  return data;
};

export const cancelPackageTransfer = async (transferIdOrName: number | string, maybeTransferId?: number) => {
  const transferId = typeof transferIdOrName === "number" ? transferIdOrName : maybeTransferId;
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

export const removePackageCollaborator = async (name: string, userId: number | string) => {
  const { data } = await api.delete(
    `/libraries/${encodePackagePath(name)}/collaborators/${encodeURIComponent(String(userId))}`,
  );
  return data;
};

export interface PublishPackageArchiveParams {
  name: string;
  version: string;
  file: File | Blob;
  tag?: string | undefined;
  description?: string | undefined;
  license?: string | undefined;
  contentHash?: string | undefined;
  signature?: string | undefined;
  publicKey?: string | undefined;
}

export const publishPackageArchive = async (
  nameOrParams: string | PublishPackageArchiveParams,
  version?: string,
  file?: File | Blob,
  options?: {
    tag?: string | undefined;
    description?: string | undefined;
    license?: string | undefined;
    contentHash?: string | undefined;
    signature?: string | undefined;
    publicKey?: string | undefined;
  },
) => {
  const resolvedName = typeof nameOrParams === "string" ? nameOrParams : nameOrParams.name;
  const resolvedVersion = typeof nameOrParams === "string" ? (version ?? "") : nameOrParams.version;
  const resolvedFile = typeof nameOrParams === "string" ? file! : nameOrParams.file;
  const resolvedOptions = typeof nameOrParams === "string" ? options : nameOrParams;

  const formData = new FormData();
  formData.append("file", resolvedFile);
  if (resolvedOptions?.tag) formData.append("tag", resolvedOptions.tag);
  if (resolvedOptions?.description) formData.append("description", resolvedOptions.description);
  if (resolvedOptions?.license) formData.append("license", resolvedOptions.license);
  if (resolvedOptions?.contentHash) formData.append("contentHash", resolvedOptions.contentHash);
  if (resolvedOptions?.signature) formData.append("signature", resolvedOptions.signature);
  if (resolvedOptions?.publicKey) formData.append("publicKey", resolvedOptions.publicKey);

  const headers: Record<string, string> = {};
  if (resolvedOptions?.contentHash) {
    headers["X-Content-SHA256"] = resolvedOptions.contentHash;
  }
  if (resolvedOptions?.signature) {
    headers["X-Package-Signature"] = resolvedOptions.signature;
  }
  if (resolvedOptions?.publicKey) {
    headers["X-Publisher-Public-Key"] = resolvedOptions.publicKey;
  }

  const { data } = await api.post(
    `/libraries/${encodePackagePath(resolvedName)}/${encodeURIComponent(resolvedVersion)}`,
    formData,
    {
      headers,
    },
  );
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
    const { data } = await api.get<NpmPackument>(`/npm/${encodePackagePath(name)}`);
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
    conversionHint?: string | undefined;
  }[];
  breakingChanges?:
    | {
        category: "connector_incompatible" | "component_removed" | "causality_drift" | "class_removed";
        className: string;
        componentName?: string | undefined;
        message: string;
        severity: "breaking" | "warning";
      }[]
    | undefined;
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
