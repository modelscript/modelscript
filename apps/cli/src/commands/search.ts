// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Argv, CommandModule } from "yargs";
import { getApiUrl, getToken } from "../util/auth.js";

export interface SearchArgs {
  query: string;
  limit?: number | undefined;
  json?: boolean | undefined;
}

export interface RegistrySearchResult {
  name: string;
  version: string;
  description?: string | undefined;
  author?: string | undefined;
  domains?: string[] | undefined;
  downloads?: number | undefined;
  license?: string | undefined;
  deprecated?: boolean | undefined;
  yanked?: boolean | undefined;
}

export interface SearchPackagesResponse {
  query: string;
  source: "libraries" | "npm";
  total: number;
  results: RegistrySearchResult[];
}

interface LibrariesApiItem {
  name: string;
  latestVersion?: string | null | undefined;
  versions?: string[] | undefined;
  description?: string | null | undefined;
  author?: string | null | undefined;
  domains?: string[] | undefined;
  totalDownloads?: number | undefined;
  license?: string | null | undefined;
  isDeprecated?: boolean | undefined;
  isYanked?: boolean | undefined;
}

interface NpmSearchApiResponse {
  objects?: Array<{
    package?: {
      name?: string | undefined;
      version?: string | undefined;
      description?: string | null | undefined;
      date?: string | undefined;
    };
  }>;
  total?: number | undefined;
}

/**
 * Searches the ModelScript / Ansatz Package Registry via `/api/v1/libraries?q=...`,
 * falling back gracefully to `/api/v1/npm/-/v1/search?text=...` if the primary endpoint
 * is unavailable or returns an unexpected payload.
 */
export async function searchRegistryPackages(
  query: string,
  options?: { limit?: number | undefined; apiUrl?: string | undefined; token?: string | null | undefined },
): Promise<SearchPackagesResponse> {
  const apiUrl = (options?.apiUrl ?? getApiUrl()).replace(/\/+$/, "");
  const limit = Math.max(1, Math.min(250, Math.floor(options?.limit ?? 20)));
  const token = options?.token !== undefined ? options.token : getToken();

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let primaryError: string | undefined;

  // 1. Primary endpoint: GET /api/v1/libraries?q=...
  try {
    const librariesUrl = `${apiUrl}/api/v1/libraries?q=${encodeURIComponent(query)}`;
    const res = await fetch(librariesUrl, { headers });
    if (res.ok) {
      const data = (await res.json()) as { packages?: LibrariesApiItem[] };
      if (Array.isArray(data.packages)) {
        const mapped: RegistrySearchResult[] = data.packages.slice(0, limit).map((pkg) => ({
          name: pkg.name,
          version: pkg.latestVersion || pkg.versions?.[0] || "0.0.0",
          ...(pkg.description ? { description: pkg.description } : {}),
          ...(pkg.author ? { author: pkg.author } : {}),
          ...(Array.isArray(pkg.domains) && pkg.domains.length > 0 ? { domains: pkg.domains } : {}),
          ...(typeof pkg.totalDownloads === "number" ? { downloads: pkg.totalDownloads } : {}),
          ...(pkg.license ? { license: pkg.license } : {}),
          ...(pkg.isDeprecated ? { deprecated: true } : {}),
          ...(pkg.isYanked ? { yanked: true } : {}),
        }));
        return {
          query,
          source: "libraries",
          total: data.packages.length,
          results: mapped,
        };
      }
      primaryError = "Unexpected response format from /api/v1/libraries";
    } else {
      primaryError = `HTTP ${res.status} ${res.statusText}`;
    }
  } catch (err) {
    primaryError = err instanceof Error ? err.message : String(err);
  }

  // 2. Fallback endpoint: GET /api/v1/npm/-/v1/search?text=...&size=...
  try {
    const npmSearchUrl = `${apiUrl}/api/v1/npm/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`;
    const res = await fetch(npmSearchUrl, { headers });
    if (res.ok) {
      const data = (await res.json()) as NpmSearchApiResponse;
      if (Array.isArray(data.objects)) {
        const mapped: RegistrySearchResult[] = data.objects
          .filter((item) => Boolean(item.package?.name))
          .slice(0, limit)
          .map((item) => ({
            name: item.package!.name!,
            version: item.package!.version || "0.0.0",
            ...(item.package!.description ? { description: item.package!.description } : {}),
          }));
        return {
          query,
          source: "npm",
          total: typeof data.total === "number" ? data.total : mapped.length,
          results: mapped,
        };
      }
    }
    throw new Error(`Fallback search failed (HTTP ${res.status} ${res.statusText})`);
  } catch (fallbackErr) {
    const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    throw new Error(`Registry search failed: ${primaryError ?? "unknown error"}; fallback: ${fallbackMsg}`, {
      cause: fallbackErr,
    });
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, Math.max(0, maxLen - 1))}…`;
}

export const Search: CommandModule<{}, SearchArgs> = {
  command: "search <query>",
  describe: "Search packages in the Ansatz / ModelScript Package Registry",
  builder: (yargs) => {
    return yargs
      .positional("query", {
        description: "Search query (package name, domain, or keyword)",
        type: "string",
        demandOption: true,
      })
      .option("limit", {
        alias: "n",
        description: "Maximum number of results to display",
        type: "number",
        default: 20,
      })
      .option("json", {
        description: "Output results as JSON",
        type: "boolean",
        default: false,
      }) as unknown as Argv<SearchArgs>;
  },
  handler: async (args) => {
    const query = String(args.query ?? "").trim();
    if (!query) {
      console.error("Error: Search query must not be empty.");
      process.exit(1);
    }

    const limit = typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0 ? args.limit : 20;

    let response: SearchPackagesResponse;
    try {
      response = await searchRegistryPackages(query, { limit });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    if (args.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    if (response.results.length === 0) {
      console.log(`No packages found matching "${query}".`);
      return;
    }

    const nameWidth = Math.min(40, Math.max(12, ...response.results.map((r) => r.name.length)));
    const verWidth = Math.min(16, Math.max(7, ...response.results.map((r) => r.version.length)));

    console.log(`${"PACKAGE".padEnd(nameWidth)}  ${"VERSION".padEnd(verWidth)}  ${"DESCRIPTION"}`);
    console.log(`${"-".repeat(nameWidth)}  ${"-".repeat(verWidth)}  ${"-".repeat(40)}`);

    for (const pkg of response.results) {
      const tags: string[] = [];
      if (pkg.deprecated) tags.push("[DEPRECATED]");
      if (pkg.yanked) tags.push("[YANKED]");
      if (pkg.domains && pkg.domains.length > 0) {
        tags.push(`(${pkg.domains.slice(0, 3).join(", ")})`);
      }
      if (typeof pkg.downloads === "number" && pkg.downloads > 0) {
        tags.push(`${pkg.downloads} dl`);
      }

      const descParts = [pkg.description ? truncate(pkg.description.replace(/\s+/g, " "), 64) : "", ...tags].filter(
        Boolean,
      );
      console.log(
        `${truncate(pkg.name, nameWidth).padEnd(nameWidth)}  ${truncate(pkg.version, verWidth).padEnd(verWidth)}  ${descParts.join(" ")}`,
      );
    }

    console.log(`\nShowing ${response.results.length} of ${response.total} result(s) for "${query}".`);
  },
};
