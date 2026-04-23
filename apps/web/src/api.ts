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
}

export const getLibraries = async (q?: string) => {
  const { data } = await api.get<{ packages: LibraryListItem[] }>("/libraries", { params: { q } });
  return data.packages;
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
    const { data } = await axios.get<NpmPackument>(`/${encodeURIComponent(name)}`);
    return data;
  } catch {
    return null;
  }
};

/**
 * Search the npm registry.
 */
export const searchRegistry = async (text: string, size = 20): Promise<NpmSearchResult> => {
  const { data } = await axios.get<NpmSearchResult>("/-/v1/search", {
    params: { text, size },
  });
  return data;
};

// ── artifact viewer API ─────────────────────────────────────────

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

export default api;
