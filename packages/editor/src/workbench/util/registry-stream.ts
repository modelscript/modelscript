// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  buildGenericSchematicSvg,
  inferDomainForFqn,
  type EngineeringDomainId,
  type GalleryComponentItem,
  type RegistryPackage,
} from "../componentGalleryCatalog";
import { inferModelDomain } from "../openModelCatalog";
import { globalClassIconCache } from "./lsp-bridge";

export interface RawRegistryStreamEntry {
  fqn: string;
  name: string;
  kind: string;
  domain: string;
  subpackage?: string | null | undefined;
  packageName: string;
  packageVersion: string;
  description?: string | null | undefined;
  language?: string | undefined;
  hasIcon?: boolean | undefined;
  hasDiagram?: boolean | undefined;
  classUrl?: string | undefined;
  iconUrl?: string | undefined;
  diagramUrl?: string | undefined;
  iconSvg?: string | undefined;
  diagramSvg?: string | undefined;
}

export interface StreamRegistryComponentsParams {
  q?: string | undefined;
  domain?: EngineeringDomainId | undefined;
  packageName?: string | null | undefined;
  subpackage?: string | null | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  includeSvg?: boolean | undefined;
}

export interface StreamRegistryComponentsResult {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  items: GalleryComponentItem[];
  availablePackages: { name: string; version: string; count: number }[];
  availableSubpackages: { id: string; label: string; count: number }[];
  packageDependencies: Record<string, Record<string, string>>;
  fromRegistry: boolean;
}

export interface StreamedRegistryModelItem {
  id: string;
  title: string;
  fqn: string;
  kind: string;
  category: Exclude<EngineeringDomainId, "all">;
  packageName: string;
  packageVersion: string;
  dialect: string;
  summary: string;
  classUrl: string;
  diagramUrl: string;
  iconUrl: string;
  diagramSvg?: string | undefined;
  iconSvg?: string | undefined;
}

export interface StreamRegistryModelsParams {
  q?: string | undefined;
  domain?: EngineeringDomainId | undefined;
  packageName?: string | null | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  includeSvg?: boolean | undefined;
}

export interface StreamRegistryModelsResult {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  models: StreamedRegistryModelItem[];
  availablePackages: { name: string; version: string; count: number }[];
  packageDependencies: Record<string, Record<string, string>>;
  fromRegistry: boolean;
}

const VALID_DOMAINS = new Set<Exclude<EngineeringDomainId, "all">>([
  "electrical",
  "mechanics",
  "fluids-thermal",
  "control",
  "power-grids",
  "robotics-cad",
  "systems",
]);

const PAGE_CACHE_TTL_MS = 30_000;
const componentPageCache = new Map<string, { expiresAt: number; data: StreamRegistryComponentsResult }>();
const modelPageCache = new Map<string, { expiresAt: number; data: StreamRegistryModelsResult }>();

export function clearRegistryStreamCache(): void {
  componentPageCache.clear();
  modelPageCache.clear();
}

export function normalizeRegistryDomain(
  rawDomain: string | undefined,
  fqn: string,
  language?: string,
): Exclude<EngineeringDomainId, "all"> {
  if (rawDomain) {
    const clean = rawDomain.trim().toLowerCase();
    if (clean === "controls") return "control";
    if (clean === "cad" || clean === "robotics") return "robotics-cad";
    if (clean === "power") return "power-grids";
    if (VALID_DOMAINS.has(clean as Exclude<EngineeringDomainId, "all">)) {
      return clean as Exclude<EngineeringDomainId, "all">;
    }
  }
  return inferDomainForFqn(fqn, language);
}

export function buildLibraryClassPathClient(packageName: string, packageVersion: string, fqn: string): string {
  const encVer = encodeURIComponent(packageVersion);
  const encClass = encodeURIComponent(fqn);
  if (packageName.startsWith("@") && packageName.includes("/")) {
    const slashIdx = packageName.indexOf("/");
    const scope = packageName.slice(0, slashIdx);
    const base = packageName.slice(slashIdx + 1);
    return `/api/v1/libraries/${encodeURIComponent(scope)}/${encodeURIComponent(base)}/${encVer}/classes/${encClass}`;
  }
  return `/api/v1/libraries/${encodeURIComponent(packageName)}/${encVer}/classes/${encClass}`;
}

export function registryEntryToGalleryItem(entry: RawRegistryStreamEntry): GalleryComponentItem {
  const category = normalizeRegistryDomain(entry.domain, entry.fqn, entry.language);
  const parts = entry.fqn.split(".");
  const subPath = parts.length > 2 ? parts.slice(1, -1).join(" · ") : entry.packageName;
  const baseIdent = entry.name.replace(/[^A-Za-z0-9_]/g, "") || "comp";
  const instIdent = `${baseIdent.charAt(0).toLowerCase()}${baseIdent.slice(1)}1`;

  if (entry.iconSvg && entry.iconSvg.includes("<svg")) {
    globalClassIconCache.set(entry.fqn, entry.iconSvg);
  }

  return {
    id: `reg:${entry.packageName}@${entry.packageVersion}:${entry.fqn}`,
    shortName: entry.name,
    fqn: entry.fqn,
    kind: entry.kind || "model",
    category,
    packageName: entry.packageName,
    packageVersion: entry.packageVersion || "1.0.0",
    summary: entry.description || `${subPath} (${entry.kind || "model"})`,
    portsAndParams: parts.length > 2 ? parts.slice(0, -1).join(".") : `${entry.kind || "model"} · ${entry.packageName}`,
    declarationSnippet: `${entry.fqn} ${instIdent};`,
    keywords: [
      entry.name.toLowerCase(),
      entry.fqn.toLowerCase(),
      entry.packageName.toLowerCase(),
      subPath.toLowerCase(),
    ],
    schematicSvg: entry.iconSvg || buildGenericSchematicSvg(entry.name, entry.kind || "model", category),
  };
}

/**
 * Merges curated + local LSP catalog components with streamed Ansatz registry components,
 * deduplicating by case-insensitive FQN while upgrading package metadata/version from the registry.
 */
export function mergeLocalAndStreamedComponents(
  localComponents: GalleryComponentItem[],
  streamedComponents: GalleryComponentItem[],
): GalleryComponentItem[] {
  if (streamedComponents.length === 0) return localComponents;
  const indexByFqn = new Map<string, number>();
  const ordered: GalleryComponentItem[] = [];

  for (const item of localComponents) {
    const key = item.fqn.toLowerCase();
    if (!indexByFqn.has(key)) {
      indexByFqn.set(key, ordered.length);
      ordered.push(item);
    }
  }

  for (const regItem of streamedComponents) {
    const key = regItem.fqn.toLowerCase();
    const existingIdx = indexByFqn.get(key);
    if (existingIdx === undefined) {
      indexByFqn.set(key, ordered.length);
      ordered.push(regItem);
    } else if (regItem.packageName.startsWith("@")) {
      const prev = ordered[existingIdx];
      if (prev && !prev.packageName.startsWith("@")) {
        ordered[existingIdx] = {
          ...prev,
          packageName: regItem.packageName,
          packageVersion: regItem.packageVersion,
        };
      }
    }
  }

  return ordered;
}

/**
 * Streams placeable schematic components across all published packages in the Ansatz registry.
 * Degrades gracefully (`fromRegistry: false`) when offline or running without the API server.
 */
export async function streamRegistryComponents(
  params: StreamRegistryComponentsParams = {},
  signal?: AbortSignal,
): Promise<StreamRegistryComponentsResult> {
  const limit = params.limit ?? 72;
  const offset = params.offset ?? 0;
  const search = new URLSearchParams();
  if (params.q && params.q.trim()) search.set("q", params.q.trim());
  if (params.domain && params.domain !== "all") search.set("domain", params.domain);
  if (params.packageName && params.packageName !== "all") search.set("package", params.packageName);
  if (params.subpackage && params.subpackage !== "all") {
    // Normalize UI pill format ("Electrical · Analog" or "Fluid › Movers") to dot-separated subpackage prefix
    const normalizedSub = params.subpackage.replace(/\s*[·›]\s*/g, ".");
    search.set("subpackage", normalizedSub);
  }
  search.set("limit", String(limit));
  search.set("offset", String(offset));
  if (params.includeSvg !== false) {
    search.set("includeSvg", "1");
  }

  const qs = search.toString();
  const now = Date.now();
  const cached = componentPageCache.get(qs);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  try {
    const resp = await fetch(`/api/v1/components?${qs}`, signal ? { signal } : undefined);
    if (!resp.ok) {
      return {
        total: 0,
        offset,
        limit,
        hasMore: false,
        items: [],
        availablePackages: [],
        availableSubpackages: [],
        packageDependencies: {},
        fromRegistry: false,
      };
    }

    const body = (await resp.json()) as {
      total?: number;
      offset?: number;
      limit?: number;
      hasMore?: boolean;
      components?: RawRegistryStreamEntry[];
      items?: RawRegistryStreamEntry[];
      availablePackages?: { name: string; version: string; count: number }[];
      availableSubpackages?: { id: string; label: string; count: number }[];
      packageDependencies?: Record<string, Record<string, string>>;
    };

    const rawList = Array.isArray(body.components) ? body.components : Array.isArray(body.items) ? body.items : [];
    const items = rawList.map(registryEntryToGalleryItem);
    const result: StreamRegistryComponentsResult = {
      total: typeof body.total === "number" ? body.total : items.length,
      offset: typeof body.offset === "number" ? body.offset : offset,
      limit: typeof body.limit === "number" ? body.limit : limit,
      hasMore: Boolean(body.hasMore),
      items,
      availablePackages: Array.isArray(body.availablePackages) ? body.availablePackages : [],
      availableSubpackages: Array.isArray(body.availableSubpackages) ? body.availableSubpackages : [],
      packageDependencies:
        body.packageDependencies && typeof body.packageDependencies === "object" ? body.packageDependencies : {},
      fromRegistry: true,
    };

    componentPageCache.set(qs, { expiresAt: now + PAGE_CACHE_TTL_MS, data: result });
    return result;
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      throw err;
    }
    return {
      total: 0,
      offset,
      limit,
      hasMore: false,
      items: [],
      availablePackages: [],
      availableSubpackages: [],
      packageDependencies: {},
      fromRegistry: false,
    };
  }
}

/**
 * Lazily fetches an individual component `icon.svg` from the Ansatz registry if not already cached.
 */
export async function fetchRegistryComponentIcon(
  packageName: string,
  packageVersion: string,
  fqn: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const existing = globalClassIconCache.get(fqn);
  if (existing) return existing;
  const classPath = buildLibraryClassPathClient(packageName, packageVersion, fqn);
  try {
    const resp = await fetch(`${classPath}/icon.svg`, signal ? { signal } : undefined);
    if (resp.status === 200) {
      const svg = await resp.text();
      if (svg.includes("<svg")) {
        globalClassIconCache.set(fqn, svg);
        return svg;
      }
    }
  } catch {
    // ignore offline / 204
  }
  return null;
}

/**
 * Streams runnable/openable models + `diagram.svg` previews across all published Ansatz packages.
 */
export async function streamRegistryModels(
  params: StreamRegistryModelsParams = {},
  signal?: AbortSignal,
): Promise<StreamRegistryModelsResult> {
  const limit = params.limit ?? 48;
  const offset = params.offset ?? 0;
  const search = new URLSearchParams();
  if (params.q && params.q.trim()) search.set("q", params.q.trim());
  if (params.domain && params.domain !== "all") search.set("domain", params.domain);
  if (params.packageName && params.packageName !== "all") search.set("package", params.packageName);
  search.set("limit", String(limit));
  search.set("offset", String(offset));
  if (params.includeSvg !== false) {
    search.set("includeSvg", "1");
  }

  const qs = search.toString();
  const now = Date.now();
  const cached = modelPageCache.get(qs);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  try {
    const resp = await fetch(`/api/v1/models?${qs}`, signal ? { signal } : undefined);
    if (!resp.ok) {
      return {
        total: 0,
        offset,
        limit,
        hasMore: false,
        models: [],
        availablePackages: [],
        packageDependencies: {},
        fromRegistry: false,
      };
    }

    const body = (await resp.json()) as {
      total?: number;
      offset?: number;
      limit?: number;
      hasMore?: boolean;
      models?: RawRegistryStreamEntry[];
      items?: RawRegistryStreamEntry[];
      availablePackages?: { name: string; version: string; count: number }[];
      packageDependencies?: Record<string, Record<string, string>>;
    };

    const rawList = Array.isArray(body.models) ? body.models : Array.isArray(body.items) ? body.items : [];
    const models: StreamedRegistryModelItem[] = rawList.map((entry) => {
      const dialect = entry.language || "modelica";
      const category = VALID_DOMAINS.has(entry.domain as Exclude<EngineeringDomainId, "all">)
        ? (entry.domain as Exclude<EngineeringDomainId, "all">)
        : inferModelDomain(entry.fqn, dialect);
      const classUrl =
        entry.classUrl || buildLibraryClassPathClient(entry.packageName, entry.packageVersion, entry.fqn);
      return {
        id: `reg-model:${entry.packageName}@${entry.packageVersion}:${entry.fqn}`,
        title: entry.name,
        fqn: entry.fqn,
        kind: entry.kind || "model",
        category,
        packageName: entry.packageName,
        packageVersion: entry.packageVersion || "1.0.0",
        dialect,
        summary: entry.description || `${entry.kind || "model"} in ${entry.packageName}@${entry.packageVersion}`,
        classUrl,
        diagramUrl: entry.diagramUrl || `${classUrl}/diagram.svg`,
        iconUrl: entry.iconUrl || `${classUrl}/icon.svg`,
        diagramSvg: entry.diagramSvg,
        iconSvg: entry.iconSvg,
      };
    });

    const result: StreamRegistryModelsResult = {
      total: typeof body.total === "number" ? body.total : models.length,
      offset: typeof body.offset === "number" ? body.offset : offset,
      limit: typeof body.limit === "number" ? body.limit : limit,
      hasMore: Boolean(body.hasMore),
      models,
      availablePackages: Array.isArray(body.availablePackages) ? body.availablePackages : [],
      packageDependencies:
        body.packageDependencies && typeof body.packageDependencies === "object" ? body.packageDependencies : {},
      fromRegistry: true,
    };

    modelPageCache.set(qs, { expiresAt: now + PAGE_CACHE_TTL_MS, data: result });
    return result;
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      throw err;
    }
    return {
      total: 0,
      offset,
      limit,
      hasMore: false,
      models: [],
      availablePackages: [],
      packageDependencies: {},
      fromRegistry: false,
    };
  }
}

/**
 * Fetches standalone source code for a class directly from the Ansatz registry API
 * (`GET /api/v1/libraries/:name/:version/classes/:className`), used as a fallback when
 * opening a streamed model whose source is not yet extracted locally.
 */
export async function fetchRegistryClassSource(
  packageName: string,
  packageVersion: string,
  fqn: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const classUrl = buildLibraryClassPathClient(packageName, packageVersion, fqn);
  try {
    const resp = await fetch(classUrl, signal ? { signal } : undefined);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { sourceCode?: string | null };
    if (typeof data.sourceCode === "string" && data.sourceCode.trim().length > 0) {
      return data.sourceCode;
    }
  } catch {
    // ignore network errors
  }
  return null;
}

/**
 * Fetches published Ansatz packages from `/api/v1/libraries` (with `/api/v1/packages` fallback)
 * and normalizes response fields to `RegistryPackage`.
 */
export async function fetchRegistryPackagesList(limit = 60, signal?: AbortSignal): Promise<RegistryPackage[]> {
  const urls = [`/api/v1/libraries?limit=${limit}`, `/api/v1/packages?limit=${limit}`];
  for (const url of urls) {
    try {
      const resp = await fetch(url, signal ? { signal } : undefined);
      if (!resp.ok) continue;
      const data = (await resp.json()) as {
        packages?: Array<
          RegistryPackage & {
            latestVersion?: string | null;
            totalDownloads?: number;
            domains?: string[];
          }
        >;
      };
      if (!Array.isArray(data.packages)) continue;
      return data.packages.map((pkg) => {
        const ver = pkg.version || pkg.latestVersion || pkg.versions?.[0] || "1.0.0";
        const domRaw = pkg.domain || pkg.domains?.[0];
        return {
          ...pkg,
          version: ver,
          versions: pkg.versions?.length ? pkg.versions : [ver],
          downloads: pkg.downloads ?? pkg.totalDownloads ?? 0,
          domain: normalizeRegistryDomain(domRaw, pkg.name, pkg.language),
        };
      });
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        throw err;
      }
    }
  }
  return [];
}
