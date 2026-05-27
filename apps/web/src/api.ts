/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import axios from "axios";

const api = axios.create({
  baseURL: "/api/v1",
});

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

  if (import.meta.env.DEV) {
    try {
      const res = await axios.get("https://registry.npmjs.org/-/v1/search", {
        params: { text: "modelica " + (q || ""), size: 10 },
      });
      return res.data.objects.map((obj: any) => ({
        name: obj.package.name,
        versions: [obj.package.version],
        latestVersion: obj.package.version,
        description: obj.package.description,
      }));
    } catch (err) {
      return [];
    }
  }

  return [];
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
  return data.classes;
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

/**
 * Rewrite `modelica://` URIs in documentation HTML:
 *
 * 1. Resource paths: `modelica://Modelica/Resources/Images/foo.png`
 *    → `/api/v1/libraries/Modelica/4.1.0/resources/Resources/Images/foo.png`
 *
 * 2. Class references: `modelica://Modelica.Electrical.Analog`
 *    → `/Modelica/4.1.0/classes/Modelica.Electrical.Analog`
 */
export function rewriteModelicaUris(html: string, version: string): string {
  // First pass: resource paths (modelica://LibName/path — contains a slash after lib name)
  let result = html.replace(/modelica:\/\/([^/\s"']+)\/([^"'\s>]+)/g, (_match, libName, resourcePath) => {
    return `/api/v1/libraries/${libName}/${version}/resources/${resourcePath}`;
  });

  // Second pass: class references (modelica://Lib.Class.Name — dotted name, no slash)
  result = result.replace(/modelica:\/\/([A-Za-z_][\w.]*)/g, (_match, className) => {
    const libName = className.split(".")[0];
    return `/${libName}/${version}/classes/${className}`;
  });

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
    return data.artifacts;
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

export const getNotificationSettings = async () => {
  const { data } = await api.get("/auth/notifications");
  return data;
};

export const updateNotificationSettings = async (settings: any) => {
  const { data } = await api.put("/auth/notifications", settings);
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

export default api;
