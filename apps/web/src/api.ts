// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";

const api = axios.create({
  baseURL: "/api/v1",
  timeout: 20000,
});

// Automatically inject Authorization header from localStorage if present
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined" && window.localStorage) {
    const token = localStorage.getItem("modelscript-auth-token");
    if (token && !config.headers["Authorization"]) {
      config.headers["Authorization"] = `Bearer ${token}`;
    }
  }
  return config;
});

// Global response interceptor to handle token expiry / 401 Unauthorized
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      if (typeof window !== "undefined" && window.localStorage) {
        localStorage.removeItem("modelscript-auth-token");
        window.dispatchEvent(new CustomEvent("modelscript:auth-expired"));
      }
    }
    return Promise.reject(error);
  },
);

export * from "./types/api";

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
  contentHash?: string;
  signature?: string;
  publishedAt?: string;
  isDeprecated?: boolean;
  deprecationReason?: string | null;
  isYanked?: boolean;
  yankReason?: string | null;
  yankedAt?: string | null;
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
  error?: string;
  logs?: string[];
}

export interface ClassDetail {
  classKind: string;
  description: string | null;
  documentation: string | null;
  extends: string[];
  components: Component[];
}

export interface LibraryListItem {
  name: string;
  versions: string[];
  latestVersion: string | null;
  description?: string;
  author?: string;
  scope?: string;
  jobStatus?: {
    status: JobStatus;
    classesProcessed?: number;
    error?: string;
  } | null;
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
    },
    {
      name: "SysML",
      versions: ["2026.3.0"],
      latestVersion: "2026.3.0",
      description: "SysML v2 Standard Library",
    },
  ];

  if (q) {
    return stdLibs.filter((lib) => lib.name.toLowerCase().includes(q.toLowerCase()));
  }
  return stdLibs;
};

export const getLibraryVersions = async (name: string) => {
  const { data } = await api.get<Library>(`/libraries/${name}`);
  return data;
};

export const getLibraryDetail = async (name: string, version: string) => {
  const { data } = await api.get<LibraryVersion>(`/libraries/${name}/${version}`);
  return data;
};

export const getClasses = async (name: string, version: string, kind?: string, q?: string) => {
  const { data } = await api.get<{ classes: ClassSummary[] }>(`/libraries/${name}/${version}/classes`, {
    params: { kind, q },
  });
  return data?.classes || [];
};

export const getClassDetail = async (name: string, version: string, className: string) => {
  const { data } = await api.get<ClassDetail>(`/libraries/${name}/${version}/classes/${className}`);
  return data;
};

export const getJobStatus = async (name: string, version: string) => {
  const { data } = await api.get<JobInfo & { name: string; version: string }>(`/libraries/${name}/${version}/status`);
  return data;
};

export const getIconUrl = (name: string, version: string, className: string) =>
  `/api/v1/libraries/${name}/${version}/classes/${className}/icon.svg`;

export const getDiagramUrl = (name: string, version: string, className: string) =>
  `/api/v1/libraries/${name}/${version}/classes/${className}/diagram.svg`;

export const getPackageStats = async (name: string, days = 30): Promise<PackageStats> => {
  const { data } = await api.get<PackageStats>(`/libraries/${name}/stats`, { params: { days } });
  return data;
};

export const deprecatePackage = async (name: string, version: string, reason: string) => {
  const { data } = await api.post(`/libraries/${name}/${version}/deprecate`, { reason });
  return data;
};

export const undeprecatePackage = async (name: string, version: string) => {
  const { data } = await api.delete(`/libraries/${name}/${version}/deprecate`);
  return data;
};

export const yankPackage = async (name: string, version: string, reason: string) => {
  const { data } = await api.post(`/libraries/${name}/${version}/yank`, { reason });
  return data;
};

export const unyankPackage = async (name: string, version: string) => {
  const { data } = await api.post(`/libraries/${name}/${version}/unyank`);
  return data;
};

export const transferPackageOwnership = async (name: string, targetUsername: string) => {
  const { data } = await api.post(`/libraries/${name}/transfer-ownership`, { targetUsername });
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

export const getPendingPackageTransfers = async () => {
  const { data } = await api.get<{ transfers: any[] }>(`/libraries/transfers/pending`);
  return data.transfers;
};

/**
 * Rewrite `modelica://` URIs in documentation HTML:
 *
 * 1. Resource paths: `modelica://Modelica/Resources/Images/foo.png`
 *    → `/api/v1/libraries/Modelica/4.1.0/resources/Resources/Images/foo.png`
 *
 * 2. Class references: `modelica://Modelica.Electrical.Analog`
 *    → `/packages/Modelica/4.1.0/classes/Modelica.Electrical.Analog`
 */
export interface PackageDependent {
  name: string;
  version: string;
  description: string | null;
}

export const getPackageDependents = async (
  name: string,
): Promise<{ name: string; count: number; dependents: PackageDependent[] }> => {
  const { data } = await api.get<{ name: string; count: number; dependents: PackageDependent[] }>(
    `/libraries/${encodeURIComponent(name)}/dependents`,
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
    return `/api/v1/libraries/${libName}/${version}/resources/${resourcePath}`;
  });

  // Second pass: class references (modelica://Lib.Class.Name — dotted name, no slash)
  result = result.replace(/modelica:\/\/([A-Za-z_][\w.]*)/g, (_match, className) => {
    const libName = className.split(".")[0];
    return `/packages/${libName}/${version}/classes/${className}`;
  });

  // Third pass: relative image/asset paths
  if (packageName && version) {
    const encodedPkg = encodeURIComponent(packageName);
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
  description?: string | null;
  "dist-tags": Record<string, string>;
  versions: Record<string, NpmVersionManifest>;
  time?: Record<string, string>;
  readme?: string;
  readmeFilename?: string;
  license?: string | null;
  homepage?: string | null;
  repository?: { type: string; url: string } | null;
}

export interface NpmVersionManifest {
  name: string;
  version: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  modelscript?: {
    languages?: string[];
    main?: string;
    modelicaVersion?: string;
    artifacts?: NpmArtifact[];
    verification?: {
      requirements?: string;
      results?: string;
    };
  };
  dist?: {
    shasum: string;
    integrity?: string;
    tarball: string;
  };
  license?: string;
  author?: { name?: string; email?: string; url?: string } | string;
  [key: string]: unknown;
}

export interface NpmArtifact {
  type: string;
  path: string;
  description?: string;
  fmiVersion?: string;
  platforms?: string[];
  [key: string]: unknown;
}

export interface NpmSearchResult {
  objects: {
    package: {
      name: string;
      version: string;
      description: string | null;
      date: string;
      links?: Record<string, string>;
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

// ── artifact viewer API ─────────────────────────────────────────

export const createBot = async (payload: {
  username: string;
  display_name: string;
  bio?: string;
  avatar_url?: string;
}) => {
  const { data } = await api.post("/users/me/bots", payload);
  return data;
};

export const getBots = async () => {
  const { data } = await api.get("/users/me/bots");
  return data.bots;
};

export const deleteBot = async (botId: number) => {
  const { data } = await api.delete(`/users/me/bots/${botId}`);
  return data;
};

// Simulation

export interface ArtifactViewDescriptor {
  viewer: string; // 'fmu-simulator' | 'dataset-table' | ...
  label: string;
  icon: string;
  config: Record<string, unknown>;
}

export interface ArtifactViewerInfo {
  id: number;
  type: string;
  path: string;
  displayName: string;
  metadata: Record<string, unknown>;
  viewer: ArtifactViewDescriptor | null;
}

/**
 * Fetch enriched artifact metadata for a package version.
 * Returns artifacts with viewer configurations (if a handler is registered).
 */
export const getArtifactViewers = async (name: string, version: string): Promise<ArtifactViewerInfo[]> => {
  try {
    const { data } = await axios.get<{ artifacts: ArtifactViewerInfo[] }>(
      `/api/v1/packages/${encodeURIComponent(name)}/${version}/artifacts`,
    );
    return data?.artifacts || [];
  } catch {
    return [];
  }
};

// ── gitlab workspace API ─────────────────────────────────────────

export interface GitlabProject {
  id: number;
  description: string | null;
  name: string;
  name_with_namespace: string;
  path: string;
  path_with_namespace: string;
  default_branch: string;
  web_url: string;
}

export interface GitlabTreeNode {
  id: string;
  name: string;
  type: "tree" | "blob";
  path: string;
  mode: string;
}

export interface GitlabCommit {
  id: string;
  short_id: string;
  title: string;
  message: string;
  author_name: string;
  author_email: string;
  created_at: string;
}

export interface GitlabPipeline {
  id: number;
  iid: number;
  project_id: number;
  status: "running" | "pending" | "success" | "failed" | "canceled" | "skipped";
  ref: string;
  sha: string;
  web_url: string;
  created_at: string;
  updated_at: string;
}

export interface GitlabJob {
  id: number;
  status: "running" | "pending" | "success" | "failed" | "canceled" | "skipped";
  stage: string;
  name: string;
  ref: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration: number | null;
  web_url: string;
  artifacts: { file_type: string; size: number; filename: string }[];
}

export interface GitlabIssue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string;
  state: string;
  created_at: string;
  updated_at: string;
  author: {
    name: string;
    avatar_url: string;
    username: string;
  };
  labels: string[];
}

export interface GitlabMergeRequest {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string;
  state: string;
  created_at: string;
  updated_at: string;
  target_branch: string;
  source_branch: string;
  author: {
    name: string;
    avatar_url: string;
    username: string;
  };
}

export const getGitlabProject = async (
  projectIdOrPath: string,
  provider: string = "gitlab",
): Promise<GitlabProject> => {
  if (provider === "github") {
    const { data } = await axios.get(`https://api.github.com/repos/${projectIdOrPath}`);
    return {
      id: data.id,
      description: data.description,
      name: data.name,
      name_with_namespace: data.full_name,
      path: data.name,
      path_with_namespace: data.full_name,
      default_branch: data.default_branch,
      web_url: data.html_url,
    };
  }
  const { data } = await api.get<GitlabProject>(`/gitlab/projects/${encodeURIComponent(projectIdOrPath)}`);
  return data;
};

export const getGitlabTree = async (
  projectIdOrPath: string,
  ref = "main",
  path = "",
  provider: string = "gitlab",
): Promise<GitlabTreeNode[]> => {
  if (provider === "github") {
    const url = path
      ? `https://api.github.com/repos/${projectIdOrPath}/contents/${path}?ref=${ref}`
      : `https://api.github.com/repos/${projectIdOrPath}/contents?ref=${ref}`;
    const { data } = await axios.get(url);
    const items = Array.isArray(data) ? data : [data];
    return items.map((item: any) => ({
      id: item.sha,
      name: item.name,
      type: item.type === "dir" ? "tree" : "blob",
      path: item.path,
      mode: "100644",
    }));
  }
  const { data } = await api.get<GitlabTreeNode[]>(
    `/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/repository/tree`,
    {
      params: { ref, path },
    },
  );
  return data;
};

export const getGitlabFileRaw = async (
  projectIdOrPath: string,
  filePath: string,
  ref = "main",
  provider: string = "gitlab",
): Promise<string> => {
  if (provider === "github") {
    const { data } = await axios.get(`https://raw.githubusercontent.com/${projectIdOrPath}/${ref}/${filePath}`);
    return typeof data === "string" ? data : JSON.stringify(data, null, 2);
  }
  const { data } = await api.get<string>(
    `/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/repository/files/${encodeURIComponent(filePath)}/raw`,
    { params: { ref } },
  );
  return data;
};

export const getGitlabCommits = async (
  projectIdOrPath: string,
  refName = "main",
  provider: string = "gitlab",
): Promise<GitlabCommit[]> => {
  if (provider === "github") {
    const { data } = await axios.get(`https://api.github.com/repos/${projectIdOrPath}/commits?sha=${refName}`);
    return data.map((c: any) => ({
      id: c.sha,
      short_id: c.sha.substring(0, 8),
      title: c.commit.message.split("\n")[0],
      message: c.commit.message,
      author_name: c.commit.author.name,
      author_email: c.commit.author.email,
      created_at: c.commit.author.date,
    }));
  }
  const { data } = await api.get<GitlabCommit[]>(
    `/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/repository/commits`,
    {
      params: { ref_name: refName },
    },
  );
  return data;
};

export const getGitlabPipelines = async (
  projectIdOrPath: string,
  refName = "main",
  provider: string = "gitlab",
): Promise<GitlabPipeline[]> => {
  if (provider === "github") {
    return []; // Simplified for now
  }
  const { data } = await api.get<GitlabPipeline[]>(
    `/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/pipelines`,
    {
      params: { ref: refName },
    },
  );
  return data;
};

export const getGitlabPipelineJobs = async (
  projectIdOrPath: string,
  pipelineId: number,
  provider: string = "gitlab",
): Promise<GitlabJob[]> => {
  if (provider === "github") return [];
  const { data } = await api.get<GitlabJob[]>(
    `/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/pipelines/${pipelineId}/jobs`,
  );
  return data;
};

export const getGitlabIssues = async (projectIdOrPath: string, provider: string = "gitlab"): Promise<GitlabIssue[]> => {
  if (provider === "github") {
    const { data } = await axios.get(`https://api.github.com/repos/${projectIdOrPath}/issues?state=open`);
    return data
      .filter((i: any) => !i.pull_request)
      .map((i: any) => ({
        id: i.id,
        iid: i.number,
        project_id: 0,
        title: i.title,
        description: i.body || "",
        state: i.state,
        created_at: i.created_at,
        updated_at: i.updated_at,
        author: {
          name: i.user.login,
          avatar_url: i.user.avatar_url,
          username: i.user.login,
        },
        labels: i.labels.map((l: any) => l.name),
      }));
  }
  const { data } = await api.get<GitlabIssue[]>(`/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/issues`);
  return data;
};

export const createGitlabIssue = async (
  projectIdOrPath: string,
  title: string,
  description: string,
  provider: string = "gitlab",
): Promise<GitlabIssue> => {
  if (provider === "github") throw new Error("Creating issues on GitHub is not supported yet.");
  const { data } = await api.post<GitlabIssue>(`/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/issues`, {
    title,
    description,
  });
  return data;
};

export const getGitlabMergeRequests = async (
  projectIdOrPath: string,
  provider: string = "gitlab",
): Promise<GitlabMergeRequest[]> => {
  if (provider === "github") {
    const { data } = await axios.get(`https://api.github.com/repos/${projectIdOrPath}/pulls?state=open`);
    return data.map((pr: any) => ({
      id: pr.id,
      iid: pr.number,
      project_id: 0,
      title: pr.title,
      description: pr.body || "",
      state: pr.state,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      target_branch: pr.base.ref,
      source_branch: pr.head.ref,
      author: {
        name: pr.user.login,
        avatar_url: pr.user.avatar_url,
        username: pr.user.login,
      },
    }));
  }
  const { data } = await api.get<GitlabMergeRequest[]>(
    `/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/merge_requests`,
  );
  return data;
};

export const updateAccount = async (data: {
  password?: string;
  username?: string;
  email?: string;
  display_name?: string;
  avatar_url?: string;
  banner_url?: string;
}) => {
  const { data: resData } = await api.put("/auth/account", data);
  return resData;
};

export const updatePassword = async (data: { oldPassword?: string; newPassword?: string }) => {
  const { data: resData } = await api.put("/auth/password", data);
  return resData;
};

export interface ArchiveJobInfo {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  format: "zip" | "json";
  queuePosition?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  fileSizeBytes?: number;
  error?: string;
  downloadUrl?: string;
  concurrency?: number;
}

export const requestUserDataArchiveJob = async (format: "zip" | "json" = "zip"): Promise<ArchiveJobInfo> => {
  const { data } = await api.post<{ success: boolean; job: ArchiveJobInfo }>("/users/me/export", { format });
  return data.job;
};

export const getUserDataArchiveStatus = async (jobId?: string): Promise<ArchiveJobInfo | null> => {
  const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
  const { data } = await api.get<{ job: ArchiveJobInfo | null }>(`/users/me/export/status${query}`);
  return data.job;
};

export const downloadUserDataArchiveJob = async (jobId?: string): Promise<Blob> => {
  const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
  const response = await api.get(`/users/me/export/download${query}`, {
    responseType: "blob",
  });
  return response.data;
};

export const exportUserDataArchive = async (format: "zip" | "json" = "zip"): Promise<Blob> => {
  const response = await api.get(`/users/me/export?format=${format}`, {
    responseType: "blob",
  });
  return response.data;
};

export const deleteAccount = async () => {
  const { data } = await api.delete("/users/me");
  return data;
};

export interface NotificationPreferences {
  qualityFilter?: boolean;
  inAppSounds?: boolean;
  emailDigestFrequency?: "instant" | "daily" | "weekly" | "never";
  channels?: {
    email: boolean;
    browserPush: boolean;
    inApp: boolean;
  };
  events?: {
    social: {
      mentions: boolean;
      replies: boolean;
      follows: boolean;
      reposts: boolean;
    };
    engineering: {
      packageUpdates: boolean;
      starredRepoCommits: boolean;
      federatedMentions: boolean;
    };
    computeHpc: {
      jobCompleted: boolean;
      jobFailed: boolean;
      quotaThresholdAlert: boolean;
    };
  };
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  qualityFilter: true,
  inAppSounds: true,
  emailDigestFrequency: "daily",
  channels: {
    email: true,
    browserPush: false,
    inApp: true,
  },
  events: {
    social: {
      mentions: true,
      replies: true,
      follows: true,
      reposts: false,
    },
    engineering: {
      packageUpdates: true,
      starredRepoCommits: true,
      federatedMentions: true,
    },
    computeHpc: {
      jobCompleted: true,
      jobFailed: true,
      quotaThresholdAlert: true,
    },
  },
};

export const getNotificationSettings = async (): Promise<NotificationPreferences> => {
  const { data } = await api.get<NotificationPreferences>("/auth/notifications");
  return data;
};

export const updateNotificationSettings = async (
  settings: Partial<NotificationPreferences>,
): Promise<{ success: boolean }> => {
  const { data } = await api.put("/auth/notifications", settings);
  return data;
};

export interface ConnectedAccount {
  provider: string;
  name: string;
  connected: boolean;
  identifier?: string;
}

export const getConnectedAccounts = async (): Promise<{ providers: ConnectedAccount[] }> => {
  const { data } = await api.get<{ providers: ConnectedAccount[] }>("/auth/connected-accounts");
  return data;
};

export const unlinkConnectedAccount = async (provider: string): Promise<{ success: boolean }> => {
  const { data } = await api.delete(`/auth/connected-accounts/${encodeURIComponent(provider)}`);
  return data;
};

export const getUserTopics = async () => {
  const { data } = await api.get("/users/me/topics");
  return data.topics as { concept: string; is_active: boolean }[];
};

export const updateUserTopic = async (concept: string, is_active: boolean) => {
  const { data } = await api.put("/users/me/topics", { concept, is_active });
  return data;
};

// ── Key Management API ──────────────────────────────────────────

export interface PublicKeyInfo {
  id: number;
  key_id_string: string;
  public_key_pem: string;
  device_name: string | null;
  created_at: string;
  is_active: number;
}

export const getPublicKeys = async (): Promise<PublicKeyInfo[]> => {
  const { data } = await api.get<{ keys: PublicKeyInfo[] }>("/auth/keys");
  return data.keys;
};

export const addPublicKey = async (key_id_string: string, public_key_pem: string, device_name?: string) => {
  const { data } = await api.post("/auth/keys", { key_id_string, public_key_pem, device_name });
  return data;
};

export const revokePublicKey = async (id: number) => {
  const { data } = await api.delete(`/auth/keys/${id}`);
  return data;
};

// ── HPC Compute Profiles API ──────────────────────────────────────

export interface ComputeProfileInfo {
  id: string;
  name: string;
  description: string;
  cpus: number;
  memoryMb: number;
  gpus: number;
  gpuType?: string;
  partition: string;
  costCreditsPerHour: number;
}

export const getComputeProfiles = async (): Promise<ComputeProfileInfo[]> => {
  try {
    const { data } = await api.get<{ profiles: ComputeProfileInfo[] }>("/cae/profiles");
    return data.profiles;
  } catch {
    return [
      {
        id: "standard",
        name: "Standard Compute",
        description: "General ODE, 2D FEA and fast simulation runs",
        cpus: 4,
        memoryMb: 16384,
        gpus: 0,
        partition: "compute",
        costCreditsPerHour: 10,
      },
      {
        id: "high-memory",
        name: "High Memory",
        description: "Large 3D FEA solid models and dense matrices",
        cpus: 16,
        memoryMb: 262144,
        gpus: 0,
        partition: "highmem",
        costCreditsPerHour: 35,
      },
      {
        id: "gpu-a100",
        name: "GPU-Accelerated (NVIDIA A100)",
        description: "Machine learning surrogates, neural operators, GPU CFD",
        cpus: 8,
        memoryMb: 65536,
        gpus: 1,
        gpuType: "a100",
        partition: "gpu",
        costCreditsPerHour: 80,
      },
      {
        id: "hpc-mpi-64",
        name: "Multi-Node MPI Cluster (64 Cores)",
        description: "High-resolution turbulent CFD and multi-domain models",
        cpus: 64,
        memoryMb: 131072,
        gpus: 0,
        partition: "mpi",
        costCreditsPerHour: 150,
      },
    ];
  }
};

// ── HPC Credit Wallet & Billing API ─────────────────────────────────

export interface UserWalletInfo {
  userId: number;
  creditBalance: number;
  totalSpent: number;
  totalJobs: number;
  totalCpuSeconds: number;
  totalGpuSeconds: number;
}

export interface CreditTransaction {
  id: number;
  user_id: number;
  job_id: number | null;
  amount: number;
  balance_after: number;
  type: "initial_grant" | "job_charge" | "top_up" | "refund";
  description: string;
  metadata?: any;
  created_at: string;
}

export interface UserBillingSummary {
  userId: number;
  creditBalance: number;
  totalSpent: number;
  totalJobs: number;
  totalCpuSeconds: number;
  totalGpuSeconds: number;
  profileUsage: Record<string, { jobsCount: number; costCredits: number; cpuSeconds: number }>;
  recentTransactions: CreditTransaction[];
}

export const getUserWallet = async (): Promise<UserWalletInfo> => {
  try {
    const { data } = await api.get<UserWalletInfo>("/billing/wallet");
    return data;
  } catch {
    return {
      userId: 1,
      creditBalance: 100.0,
      totalSpent: 0,
      totalJobs: 0,
      totalCpuSeconds: 0,
      totalGpuSeconds: 0,
    };
  }
};

export const getUserTransactions = async (
  limit = 50,
  offset = 0,
): Promise<{ transactions: CreditTransaction[]; count: number }> => {
  try {
    const { data } = await api.get<{ transactions: CreditTransaction[]; count: number }>("/billing/transactions", {
      params: { limit, offset },
    });
    return data;
  } catch {
    return { transactions: [], count: 0 };
  }
};

export const getUserBillingSummary = async (): Promise<UserBillingSummary> => {
  try {
    const { data } = await api.get<UserBillingSummary>("/billing/usage");
    return data;
  } catch {
    return {
      userId: 1,
      creditBalance: 100.0,
      totalSpent: 0,
      totalJobs: 0,
      totalCpuSeconds: 0,
      totalGpuSeconds: 0,
      profileUsage: {},
      recentTransactions: [],
    };
  }
};

export const topUpCredits = async (
  amount: number,
  paymentMethod = "sandbox_card",
): Promise<{ success: boolean; amountAdded: number; newBalance: number }> => {
  const { data } = await api.post("/billing/topup", { amount, paymentMethod });
  return data;
};

export interface HpcJobSummary {
  id: number;
  name: string;
  status: string;
  solver: string;
  computeProfile: string;
  cpuSeconds: number;
  gpuSeconds: number;
  costCredits: number;
  startedAt: string;
  completedAt: string | null;
  hasVtu: boolean;
  hasScalars: boolean;
  scalars?: Record<string, any>;
  resultDir?: string;
}

export interface ArtifactViewFromJobResult {
  id: number;
  artifactId: number;
  suggestedCaption: string;
  viewConfig: Record<string, unknown>;
}

export const getUserHpcJobs = async (limit = 20): Promise<HpcJobSummary[]> => {
  try {
    const { data } = await api.get<{ jobs: HpcJobSummary[]; count: number }>("/cae/user-jobs", {
      params: { limit },
    });
    return data.jobs || [];
  } catch {
    return [];
  }
};

export const createArtifactViewFromHpcJob = async (
  jobId: number,
  options?: { colormap?: string; activeField?: string; title?: string },
): Promise<ArtifactViewFromJobResult> => {
  const { data } = await api.post<ArtifactViewFromJobResult>("/social/artifact-views/from-hpc-job", {
    jobId,
    ...options,
  });
  return data;
};

export const getHpcJobReproduceSpec = async (jobId: number) => {
  const { data } = await api.get(`/cae/jobs/${jobId}/reproduce-spec`);
  return data;
};

// ── Cloud Simulation API ──────────────────────────────────────────

export interface CloudSimulationRequest {
  modelName: string;
  modelSource?: string;
  libraryName?: string;
  libraryVersion?: string;
  dependencies?: { name: string; version: string }[];
  profile?: string;
  numberOfIntervals?: number;
}

export interface CloudSimulationStatus {
  id: string;
  status: "pending" | "processing" | "queued" | "running" | "completed" | "success" | "failed" | string;
  profile?: string;
  usage?: {
    cpuSeconds: number;
    gpuSeconds: number;
    costCredits: number;
    exitCode: number;
  };
  error?: string;
}

export const submitCloudSimulation = async (req: CloudSimulationRequest): Promise<{ jobId: string }> => {
  const { data } = await api.post<{ jobId: string }>("/simulate", req);
  return data;
};

export const getCloudSimulationStatus = async (jobId: string): Promise<CloudSimulationStatus> => {
  const { data } = await api.get<CloudSimulationStatus>(`/simulate/${jobId}`);
  return data;
};

export const getCloudSimulationResultCsv = async (jobId: string): Promise<string> => {
  const { data } = await api.get<string>(`/simulate/${jobId}/result`, {
    responseType: "text",
  });
  return data;
};

// ── Cluster Health & Live HPC Queues ───────────────────────────────

export interface ClusterStatus {
  backend: "slurm-rest" | "slurm" | "local-process" | string;
  connected: boolean;
  latencyMs: number;
  version?: string;
  stagingBackend?: string;
  partitions: { name: string; state: string }[];
  nodesCount: number;
  nodes?: { name: string; state: string }[];
}

export const getClusterStatus = async (): Promise<ClusterStatus> => {
  try {
    const { data } = await api.get<ClusterStatus>("/cae/cluster/status");
    return data;
  } catch {
    return {
      backend: "local-process",
      connected: true,
      latencyMs: 8,
      version: "local",
      partitions: [{ name: "default", state: "UP" }],
      nodesCount: 1,
      nodes: [{ name: "compute-local", state: "idle" }],
    };
  }
};

export interface UnifiedJob {
  id: string | number;
  name: string;
  domain: string;
  profile: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "SUCCESS" | "FAILED" | string;
  progress?: number;
  costCredits?: number;
  elapsedSeconds?: number;
  startedAt?: string | number;
  hasVtu?: boolean;
  hasCsv?: boolean;
}

export const getUnifiedUserJobs = async (limit = 50): Promise<UnifiedJob[]> => {
  const jobs: UnifiedJob[] = [];

  try {
    const cloudRes = await api.get<{ jobs: any[] }>("/cloud/jobs");
    if (cloudRes.data?.jobs && Array.isArray(cloudRes.data.jobs)) {
      for (const j of cloudRes.data.jobs) {
        jobs.push({
          id: j.jobId,
          name: j.name || `Job #${String(j.jobId).slice(0, 8)}`,
          domain: j.domain || "modelica",
          profile: j.profile || "standard",
          status: j.status,
          costCredits: j.costCredits,
          startedAt: j.startTime,
        });
      }
    }
  } catch {
    // Ignore error fetching jobs
  }

  try {
    const caeRes = await api.get<{ jobs: any[] }>("/cae/user-jobs", { params: { limit } });
    if (caeRes.data?.jobs && Array.isArray(caeRes.data.jobs)) {
      for (const j of caeRes.data.jobs) {
        if (!jobs.some((existing) => String(existing.id) === String(j.id))) {
          jobs.push({
            id: j.id,
            name: j.name,
            domain: j.solver === "su2" ? "cfd" : j.solver === "calculix" ? "fea" : "simulation",
            profile: j.computeProfile || "standard",
            status: j.status === "SUCCESS" ? "completed" : j.status === "FAILED" ? "failed" : "running",
            costCredits: j.costCredits,
            startedAt: j.startedAt,
            hasVtu: j.hasVtu,
            hasCsv: j.hasScalars,
          });
        }
      }
    }
  } catch {
    // Ignore error fetching cae jobs
  }

  return jobs;
};

// ── Admin Section APIs ──────────────────────────────────────────────

export interface AdminModerationReport {
  id: number;
  reporter_id: number | null;
  reporter_username?: string;
  target_type: "post" | "user" | "comment" | string;
  target_id?: number | string;
  post_id?: number;
  post_content?: string;
  author_username?: string;
  reason: string;
  status: "pending" | "resolved" | "dismissed";
  resolution_notes?: string;
  created_at: string;
  resolved_at?: string;
}

export interface AdminFederationDomain {
  domain: string;
  tier: "allow" | "silence" | "suspend";
  reason?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AdminDmcaNotice {
  id: number;
  claimant_name: string;
  claimant_email: string;
  copyright_owner: string;
  work_description: string;
  infringing_url: string;
  resource_type?: string;
  resource_id?: string;
  status: "pending" | "resolved" | "rejected";
  action_taken?: string;
  created_at: string;
  resolved_at?: string;
}

export interface AdminAuditLog {
  id: number;
  actor_id: number | null;
  actor_username?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  ip_address?: string;
  details?: any;
  created_at: string;
}

export interface AdminDbStatus {
  currentVersion: string | number | null;
  latestVersion?: string | number | null;
  pendingCount?: number;
  applied?: { id: number; name: string; applied_at?: string; checksum?: string; execution_ms?: number }[];
  pending?: { id?: number; name: string }[];
  pendingMigrations?: { id: number; name: string }[];
  appliedMigrations?: { id: number; name: string; applied_at?: string }[];
}

export const getAdminModerationQueue = async (
  status?: string,
  limit = 50,
  offset = 0,
): Promise<{ reports: AdminModerationReport[]; count: number }> => {
  const { data } = await api.get("/admin/moderation/queue", { params: { status, limit, offset } });
  return data;
};

export const resolveAdminModerationReport = async (
  id: number,
  data: {
    status: "resolved" | "dismissed";
    resolutionNotes?: string;
    action?: "none" | "delete_post" | "silence_domain" | "suspend_domain";
  },
): Promise<{ success: boolean; reportId: number; status: string; actionExecuted: string }> => {
  const res = await api.post(`/admin/moderation/reports/${id}/resolve`, data);
  return res.data;
};

export const deleteAdminPost = async (
  postId: number,
): Promise<{ success: boolean; postId: number; tombstonePropagated: boolean }> => {
  const { data } = await api.delete(`/admin/posts/${postId}`);
  return data;
};

export const getAdminFederationDomains = async (): Promise<{ domains: AdminFederationDomain[]; count: number }> => {
  const { data } = await api.get("/admin/federation/domains");
  return data;
};

export const setAdminFederationDomainTier = async (
  domain: string,
  tier: "allow" | "silence" | "suspend",
  reason?: string,
): Promise<{ success: boolean; domain: string; tier: string; reason?: string }> => {
  const { data } = await api.post("/admin/federation/domains", { domain, tier, reason });
  return data;
};

export const deleteAdminFederationDomainTier = async (
  domain: string,
): Promise<{ success: boolean; domain: string }> => {
  const { data } = await api.delete(`/admin/federation/domains/${domain}`);
  return data;
};

export const getAdminDmcaNotices = async (status?: string): Promise<{ notices: AdminDmcaNotice[]; count: number }> => {
  const { data } = await api.get("/admin/dmca/notices", { params: { status } });
  return data;
};

export const resolveAdminDmcaNotice = async (
  id: number,
  actionTaken: string,
): Promise<{ success: boolean; noticeId: number; actionTaken: string }> => {
  const { data } = await api.post(`/admin/dmca/notices/${id}/resolve`, { actionTaken });
  return data;
};

export const getAdminAuditLogs = async (
  limit = 50,
  offset = 0,
  action?: string,
): Promise<{ logs: AdminAuditLog[]; count: number }> => {
  const { data } = await api.get("/admin/audit-logs", { params: { limit, offset, action } });
  return data;
};

export const getAdminDbStatus = async (): Promise<AdminDbStatus> => {
  const { data } = await api.get("/admin/db/status");
  return data;
};

export const runAdminDbUpgrade = async (options?: {
  dryRun?: boolean;
  skipBackup?: boolean;
}): Promise<{ success: boolean; appliedCount?: number; dryRun?: boolean; error?: string }> => {
  const { data } = await api.post("/admin/db/upgrade", options || {});
  return data;
};

export const verifyAdminDbIntegrity = async (): Promise<{
  valid?: boolean;
  foreignKeysOk?: boolean;
  integrityOk?: boolean;
  issues?: string[];
}> => {
  const { data } = await api.get("/admin/db/verify");
  return data;
};

export interface AdminFeatureFlag {
  key: string;
  name: string;
  description: string;
  defaultValue: boolean;
  category: string;
  maturity: string;
  allowedRoles?: string[];
  currentEnabled: boolean;
  rolloutPercentage: number;
  dbAllowedRoles: string[];
}

export const getAdminFeatureFlags = async (): Promise<{ flags: AdminFeatureFlag[] }> => {
  const { data } = await api.get("/admin/flags");
  return data;
};

export const patchAdminFeatureFlag = async (
  key: string,
  isEnabled: boolean,
  allowedRoles?: string,
  rolloutPercentage?: number,
): Promise<{ success: boolean; key: string; isEnabled: boolean }> => {
  const { data } = await api.patch(`/admin/flags/${key}`, { isEnabled, allowedRoles, rolloutPercentage });
  return data;
};

// ── Social, Posts, Feeds & Repos API ────────────────────────────────

export const getUserProfile = async (username: string): Promise<any> => {
  const { data } = await api.get(`/users/${encodeURIComponent(username)}`);
  return data;
};

export const followUser = async (username: string): Promise<any> => {
  const { data } = await api.post(`/users/${encodeURIComponent(username)}/follow`);
  return data;
};

export const unfollowUser = async (username: string): Promise<any> => {
  const { data } = await api.delete(`/users/${encodeURIComponent(username)}/follow`);
  return data;
};

export const blockUser = async (username: string): Promise<any> => {
  const { data } = await api.post(`/users/${encodeURIComponent(username)}/block`);
  return data;
};

export const unblockUser = async (username: string): Promise<any> => {
  const { data } = await api.delete(`/users/${encodeURIComponent(username)}/block`);
  return data;
};

export const muteUser = async (username: string): Promise<any> => {
  const { data } = await api.post(`/users/${encodeURIComponent(username)}/mute`);
  return data;
};

export const unmuteUser = async (username: string): Promise<any> => {
  const { data } = await api.delete(`/users/${encodeURIComponent(username)}/mute`);
  return data;
};

export const reportUser = async (username: string, reason?: string): Promise<any> => {
  const { data } = await api.post(`/users/${encodeURIComponent(username)}/report`, { reason });
  return data;
};

export const updateUserProfile = async (profileData: Record<string, any>): Promise<any> => {
  const { data } = await api.put("/users/me", profileData);
  return data;
};

export const getUserFollowers = async (username: string): Promise<{ followers: any[] }> => {
  const { data } = await api.get(`/users/${encodeURIComponent(username)}/followers`);
  return data;
};

export const getUserFollowing = async (username: string): Promise<{ following: any[] }> => {
  const { data } = await api.get(`/users/${encodeURIComponent(username)}/following`);
  return data;
};

export const getUserSuggestions = async (limit = 4): Promise<{ suggestions: any[] }> => {
  const { data } = await api.get("/users/suggestions", { params: { limit } });
  return data;
};

export const getUserPosts = async (
  username: string,
  type?: "posts" | "replies" | "artifacts",
): Promise<{ posts: any[] }> => {
  const { data } = await api.get(`/social/users/${encodeURIComponent(username)}/posts`, {
    params: type ? { type } : undefined,
  });
  return data;
};

export const getTimeline = async (options?: {
  following?: boolean;
  federated?: boolean;
  sort?: string;
  limit?: number;
  offset?: number;
  artifactType?: string;
  tag?: string;
}): Promise<{ posts: any[] }> => {
  const endpoint = options?.federated
    ? "/social/timeline/federated"
    : options?.following
      ? "/social/timeline/following"
      : "/social/timeline";
  const params: Record<string, any> = {};
  if (options?.sort) params.sort = options.sort;
  if (options?.limit !== undefined) params.limit = options.limit;
  if (options?.offset !== undefined) params.offset = options.offset;
  if (options?.artifactType) params.artifactType = options.artifactType;
  if (options?.tag) params.tag = options.tag;
  const { data } = await api.get(endpoint, { params: Object.keys(params).length > 0 ? params : undefined });
  return data;
};

export const getPost = async (id: string | number): Promise<{ post: any }> => {
  const { data } = await api.get(`/social/posts/${id}`);
  return data;
};

export const getPostReplies = async (id: string | number): Promise<{ posts: any[] }> => {
  const { data } = await api.get(`/social/posts/${id}/replies`);
  return data;
};

export const getPostParents = async (id: string | number): Promise<{ posts: any[] }> => {
  const { data } = await api.get(`/social/posts/${id}/parents`);
  return data;
};

export const getPostQuotes = async (id: string | number): Promise<{ posts: any[] }> => {
  const { data } = await api.get(`/social/posts/${id}/quotes`);
  return data;
};

export const getPostReposts = async (id: string | number): Promise<{ posts: any[] }> => {
  const { data } = await api.get(`/social/posts/${id}/reposts`);
  return data;
};

export const recordPostView = async (id: string | number): Promise<void> => {
  await api.post(`/social/posts/${id}/view`).catch(() => {});
};

export const getPostAnalytics = async (id: string | number): Promise<any> => {
  const { data } = await api.get(`/social/posts/${id}/analytics`);
  return data;
};

export const likePost = async (id: string | number): Promise<{ liked: boolean }> => {
  const { data } = await api.post(`/social/posts/${id}/like`);
  return data;
};

export const repostPost = async (id: string | number): Promise<{ reposted: boolean }> => {
  const { data } = await api.post(`/social/posts/${id}/repost`);
  return data;
};

export const bookmarkPost = async (id: string | number): Promise<{ bookmarked: boolean }> => {
  const { data } = await api.post(`/social/posts/${id}/bookmark`);
  return data;
};

export const createPost = async (payload: Record<string, any>): Promise<{ post: any }> => {
  const { data } = await api.post("/social/posts", payload);
  return data;
};

export const getBookmarks = async (): Promise<{ posts: any[] }> => {
  const { data } = await api.get("/social/bookmarks");
  return data;
};

export const getNotifications = async (category?: string): Promise<{ notifications: any[]; unreadCount?: number }> => {
  const params = category && category !== "all" ? { category } : undefined;
  const { data } = await api.get("/social/notifications", { params });
  return data;
};

export const markNotificationsRead = async (category?: string): Promise<void> => {
  const body = category && category !== "all" ? { category } : undefined;
  await api.post("/social/notifications/read", body);
};

export const getFeeds = async (): Promise<{ feeds: any[] }> => {
  const { data } = await api.get("/social/feeds");
  return data;
};

export const subscribeFeed = async (url: string): Promise<any> => {
  const { data } = await api.post("/social/feeds/subscribe", { url });
  return data;
};

export const unsubscribeFeed = async (id: string | number): Promise<any> => {
  const { data } = await api.delete(`/social/feeds/${id}/unsubscribe`);
  return data;
};

export const getTrending = async (limit = 4): Promise<{ topics: any[] }> => {
  const { data } = await api.get("/social/trending", { params: { limit } });
  return data;
};

export const getExplore = async (options?: {
  limit?: number;
  offset?: number;
  artifactType?: string;
  tag?: string;
}): Promise<{ posts: any[] }> => {
  const params: Record<string, any> = {};
  if (options?.limit !== undefined) params.limit = options.limit;
  if (options?.offset !== undefined) params.offset = options.offset;
  if (options?.artifactType) params.artifactType = options.artifactType;
  if (options?.tag) params.tag = options.tag;
  const { data } = await api.get("/social/explore", { params: Object.keys(params).length > 0 ? params : undefined });
  return data;
};

export const getTopicPosts = async (
  topic: string,
  options?: { limit?: number; offset?: number; artifactType?: string },
): Promise<{ posts: any[] }> => {
  const params: Record<string, any> = {};
  if (options?.limit !== undefined) params.limit = options.limit;
  if (options?.offset !== undefined) params.offset = options.offset;
  if (options?.artifactType) params.artifactType = options.artifactType;
  const { data } = await api.get(`/social/topics/${encodeURIComponent(topic)}/posts`, {
    params: Object.keys(params).length > 0 ? params : undefined,
  });
  return data;
};

export const getRepos = async (): Promise<{ repos: any[] }> => {
  const { data } = await api.get("/repos");
  return data;
};

export const getPopularRepos = async (limit?: number): Promise<{ repos: any[] }> => {
  const { data } = await api.get("/repos/popular", { params: limit ? { limit } : undefined });
  return data;
};

export const createRepo = async (repoData: Record<string, any>): Promise<any> => {
  const { data } = await api.post("/repos", repoData);
  return data;
};

export const createArtifactView = async (artifactData: Record<string, any>): Promise<any> => {
  const { data } = await api.post("/social/artifact-views", artifactData);
  return data;
};

export const getArtifactView = async (id: string | number): Promise<any> => {
  const { data } = await api.get(`/social/artifact-views/${encodeURIComponent(String(id))}`);
  return data;
};

export const uploadArtifactThumbnail = async (
  id: string | number,
  dataUrl: string,
): Promise<{ success: boolean; thumbnailUrl: string }> => {
  const { data } = await api.put(`/social/artifact-views/${encodeURIComponent(String(id))}/thumbnail`, { dataUrl });
  return data;
};

export const uploadStorageFile = async (formData: FormData): Promise<any> => {
  const { data } = await api.post("/storage/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
};

export const getSearchCompletions = async (
  query: string,
  limit = 6,
): Promise<{ suggestions?: any[]; completions?: any[] }> => {
  const { data } = await api.get("/search/completions", { params: { q: query, limit } });
  return data;
};

// ── Background Jobs & Script Templates API ──────────────────────────

export const getDbJobs = async (): Promise<{ jobs: any[] }> => {
  const { data } = await api.get("/jobs");
  return data;
};

export const getJobTemplates = async (): Promise<{ templates: any[] }> => {
  const { data } = await api.get("/jobs/templates");
  return data;
};

export const getJobLogs = async (id: string | number): Promise<any> => {
  const { data } = await api.get(`/jobs/${id}/logs`);
  return data;
};

export const getJobDetails = async (id: string | number): Promise<{ job: any; steps?: any[] }> => {
  const { data } = await api.get(`/jobs/${id}`);
  return data;
};

export const getJobTemplate = async (id: string | number): Promise<any> => {
  const { data } = await api.get(`/jobs/templates/${id}`);
  return data;
};

export const runJobTemplate = async (id: string | number, payload?: any): Promise<any> => {
  const { data } = await api.post(`/jobs/templates/${id}/run`, payload || {});
  return data;
};

export const cancelDbJob = async (id: string | number): Promise<any> => {
  const { data } = await api.post(`/jobs/${id}/cancel`);
  return data;
};

// ── Dev & System API ────────────────────────────────────────────────
export const resetDevDb = async (): Promise<any> => {
  const { data } = await api.post("/dev/reset");
  return data;
};

// ── MQTT API ────────────────────────────────────────────────────────
export const getMqttParticipants = async (
  apiBaseUrl?: string,
): Promise<{ participants: any[]; connected: boolean }> => {
  if (apiBaseUrl) {
    const res = await axios.get(`${apiBaseUrl}/api/v1/mqtt/participants`, { timeout: 10000 });
    return res.data;
  }
  const { data } = await api.get("/mqtt/participants");
  return data;
};

// ── Cloud HPC & Simulation API ──────────────────────────────────────
export const getCloudProfiles = async (): Promise<{ profiles: any[] }> => {
  const { data } = await api.get("/cloud/profiles");
  return data;
};

export const getCloudBalance = async (): Promise<{ balance: number }> => {
  const { data } = await api.get("/cloud/balance");
  return data;
};

export const dispatchCloudJob = async (payload: any): Promise<{ jobId: string }> => {
  const { data } = await api.post("/cloud/dispatch", payload);
  return data;
};

export const getCloudJobResult = async (jobId: string | number): Promise<string> => {
  const { data } = await api.get(`/cloud/jobs/${jobId}/result`, { responseType: "text" });
  return data;
};

export const getSimulationJobResult = async (jobId: string | number): Promise<string> => {
  const { data } = await api.get(`/simulate/${jobId}/result`, { responseType: "text" });
  return data;
};

// ── Physics & CAD API ───────────────────────────────────────────────
export const flattenPhysicsStudy = async (className: string): Promise<any> => {
  const { data } = await api.get("/physics/flattenStudy", { params: { className } });
  return data;
};

export const uploadPhysicsGeometry = async (formData: FormData): Promise<{ hash: string }> => {
  const { data } = await api.post("/physics/upload", formData);
  return data;
};

export const runPhysicsJob = async (payload: { geometryHash: string; config: any }): Promise<{ jobId: string }> => {
  const { data } = await api.post("/physics/run", payload);
  return data;
};

export const convertCadGeometry = async (url: string): Promise<any> => {
  const { data } = await api.get("/cad/convert", { params: { url } });
  return data;
};

export const resolveFederatedActor = async (handle: string): Promise<any> => {
  const { data } = await api.post("/federation/resolve", { handle });
  return data;
};

export const verifyEmail = async (
  token: string,
): Promise<{ success: boolean; message: string; creditsGranted: number; user: any }> => {
  const { data } = await api.post("/auth/verify-email", { token });
  return data;
};

export const resendVerificationEmail = async (email: string): Promise<{ success?: boolean; message: string }> => {
  const { data } = await api.post("/auth/resend-verification", { email });
  return data;
};

export const requestPasswordReset = async (
  email: string,
): Promise<{ success: boolean; message: string; resetToken?: string }> => {
  const { data } = await api.post("/auth/forgot-password", { email });
  return data;
};

export const resetPassword = async (
  token: string,
  newPassword: string,
): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.post("/auth/reset-password", { token, newPassword });
  return data;
};

export const revokeAllSessions = async (): Promise<{ success: boolean; message: string; token: string }> => {
  const { data } = await api.post("/auth/revoke-sessions");
  return data;
};

export interface Setup2FAResponse {
  secret: string;
  otpauthUri: string;
  message: string;
}

export interface Verify2FAResponse {
  success: boolean;
  message: string;
  backupCodes: string[];
}

export interface Challenge2FAResponse {
  token: string;
  user: any;
  message: string;
}

export const setup2FA = async (): Promise<Setup2FAResponse> => {
  const { data } = await api.post("/auth/2fa/setup");
  return data;
};

export const verify2FA = async (code: string): Promise<Verify2FAResponse> => {
  const { data } = await api.post("/auth/2fa/verify", { code });
  return data;
};

export const challenge2FA = async (tempToken: string, code: string): Promise<Challenge2FAResponse> => {
  const { data } = await api.post("/auth/2fa/challenge", { tempToken, code });
  return data;
};

export const disable2FA = async (password?: string, code?: string): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.post("/auth/2fa/disable", { password, code });
  return data;
};

export const logoutApi = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const { data } = await api.post("/auth/logout");
    return data;
  } catch {
    return { success: true, message: "Logged out" };
  }
};

export interface VersionComparisonResult {
  versionDelta: { base: string; head: string };
  classes: {
    added: { name: string; kind: string; description: string | null }[];
    removed: { name: string; kind: string; description: string | null }[];
    modified: {
      name: string;
      kind: string;
      parameterChanges: { name: string; old: unknown; new: unknown; unit?: string }[];
    }[];
  };
  cadChanges: {
    file: string;
    status: "added" | "removed" | "modified" | "unchanged";
    volumeDeltaPercent?: number;
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
  const { data } = await api.get(`/libraries/${encodeURIComponent(name)}/compare`, {
    params: { base, head },
  });
  return data;
};

export interface ThreadProposalDto {
  id: number;
  thread_id: string;
  title: string;
  description: string | null;
  status: "open" | "approved" | "rejected" | "applied";
  proposed_by: string;
  diff_summary: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  review_comment: string | null;
}

export interface ThreadAuditLogDto {
  id: number;
  thread_id: string;
  proposal_id: number | null;
  action: string;
  actor: string;
  safety_standard: string | null;
  checksum: string;
  metadata: string | null;
  created_at: string;
}

export const getThreadProposals = async (params?: {
  threadId?: string;
  status?: string;
}): Promise<ThreadProposalDto[]> => {
  const { data } = await api.get("/threads/proposals", { params });
  return data.proposals || [];
};

export const createThreadProposal = async (payload: {
  threadId: string;
  title: string;
  description?: string;
  proposedBy?: string;
  diffSummary?: any;
  safetyStandard?: string;
}): Promise<ThreadProposalDto> => {
  const { data } = await api.post("/threads/proposals", payload);
  return data.proposal;
};

export const reviewThreadProposal = async (
  id: number,
  payload: {
    status: "approved" | "rejected" | "applied";
    comment?: string;
    resolvedBy?: string;
    safetyStandard?: string;
  },
): Promise<ThreadProposalDto> => {
  const { data } = await api.post(`/threads/proposals/${id}/review`, payload);
  return data.proposal;
};

export const getThreadAuditLogs = async (params?: {
  threadId?: string;
}): Promise<{ auditLogs: ThreadAuditLogDto[]; verification: { valid: boolean; totalEntries: number } }> => {
  const { data } = await api.get("/threads/audit-log", { params });
  return data;
};

export { api };
export default api;
