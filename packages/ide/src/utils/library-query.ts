// SPDX-License-Identifier: AGPL-3.0-or-later

const STDLIB_ALIAS_MAP: Record<string, { name: string; version: string }> = {
  modelica: { name: "Modelica", version: "4.1.0" },
  msl: { name: "Modelica", version: "4.1.0" },
  sysml: { name: "SysML", version: "2026.3.0" },
  sysml2: { name: "SysML", version: "2026.3.0" },
  kerml: { name: "SysML", version: "2026.3.0" },
};

/**
 * Parses URL query parameters (`stdlib`, `libs`, `packages`, `lib`) from a location hash or URI query string
 * into concrete `{ name, version }` dependency descriptors.
 *
 * Examples:
 * - `"stdlib=modelica"` -> `{ explicit: true, deps: [{ name: "Modelica", version: "4.1.0" }] }`
 * - `"stdlib=sysml2&libs=PlanarMechanics@1.6.0"` -> `{ explicit: true, deps: [{ name: "SysML", version: "2026.3.0" }, { name: "PlanarMechanics", version: "1.6.0" }] }`
 * - `"stdlib=none"` -> `{ explicit: true, deps: [] }`
 */
export function parseLibrarySpecsFromQuery(rawQueryOrHash: string): {
  explicit: boolean;
  deps: { name: string; version: string }[];
} {
  if (!rawQueryOrHash) return { explicit: false, deps: [] };
  let queryPart = rawQueryOrHash;
  const qIdx = queryPart.indexOf("?");
  if (qIdx !== -1) {
    queryPart = queryPart.slice(qIdx + 1);
  } else if (queryPart.startsWith("#")) {
    return { explicit: false, deps: [] };
  }

  const params = new URLSearchParams(queryPart);
  const rawTokens: string[] = [];
  let explicit = false;

  for (const key of ["stdlib", "libs", "packages", "lib"]) {
    const values = params.getAll(key);
    if (values.length > 0) {
      explicit = true;
      for (const val of values) {
        for (const piece of val.split(",")) {
          const trimmed = piece.trim();
          if (trimmed) rawTokens.push(trimmed);
        }
      }
    }
  }

  if (!explicit) return { explicit: false, deps: [] };
  if (rawTokens.length === 1 && (rawTokens[0]!.toLowerCase() === "none" || rawTokens[0] === "0")) {
    return { explicit: true, deps: [] };
  }

  const seen = new Map<string, { name: string; version: string }>();
  for (const token of rawTokens) {
    const lower = token.toLowerCase();
    if (lower === "none" || lower === "0") continue;

    const stdAlias = STDLIB_ALIAS_MAP[lower];
    if (stdAlias) {
      seen.set(stdAlias.name.toLowerCase(), { ...stdAlias });
      continue;
    }

    const atIdx = token.lastIndexOf("@");
    let pkgName = token;
    let pkgVersion = "latest";
    if (atIdx > 0) {
      pkgName = token.slice(0, atIdx);
      pkgVersion = token.slice(atIdx + 1) || "latest";
    }

    const aliasByName = STDLIB_ALIAS_MAP[pkgName.toLowerCase()];
    if (aliasByName) {
      seen.set(aliasByName.name.toLowerCase(), {
        name: aliasByName.name,
        version: pkgVersion === "latest" ? aliasByName.version : pkgVersion,
      });
    } else if (pkgName) {
      seen.set(pkgName.toLowerCase(), { name: pkgName, version: pkgVersion });
    }
  }

  return { explicit: true, deps: [...seen.values()] };
}
