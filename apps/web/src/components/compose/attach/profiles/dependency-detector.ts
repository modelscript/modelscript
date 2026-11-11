// SPDX-License-Identifier: AGPL-3.0-or-later

import { CURATED_ANSATZ_PACKAGES, type RegistryPackage } from "../../../morsel/componentGalleryCatalog";

export interface ArtifactLibraryDependency {
  name: string;
  version: string;
  autoDetected?: boolean;
  resolvedFrom?: "uses-annotation" | "ast-identifier" | "user-specified";
  description?: string;
  verified?: boolean;
  availableVersions?: string[];
}

const BUILTIN_NAMESPACES = new Set<string>([
  "modelica",
  "complex",
  "modelicaservices",
  "modelicareference",
  "modelicastandardtables",
  "real",
  "integer",
  "boolean",
  "string",
  "time",
]);

function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '" "');
}

/**
 * Extracts declared dependencies from Modelica `annotation(uses(...))` clauses.
 */
export function extractModelicaUsesDependencies(source: string): Array<{ name: string; version: string }> {
  const deps: Array<{ name: string; version: string }> = [];
  const seen = new Set<string>();

  const usesRegex = /\buses\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = usesRegex.exec(source)) !== null) {
    const startIdx = match.index + match[0].length;
    let depth = 1;
    let endIdx = startIdx;
    while (endIdx < source.length && depth > 0) {
      const ch = source[endIdx];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      endIdx++;
    }
    const usesBody = source.slice(startIdx, Math.max(startIdx, endIdx - 1));
    const depRe = /([A-Za-z_]\w*)\s*\(\s*version\s*=\s*"([^"]+)"\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = depRe.exec(usesBody)) !== null) {
      const name = m[1]!;
      const version = m[2]!.trim();
      if (name && version && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        deps.push({ name, version });
      }
    }
  }

  return deps;
}

/**
 * Finds a matching package definition from curated packages or case-insensitive search.
 */
export function findCuratedPackage(name: string): RegistryPackage | undefined {
  const norm = name.trim().toLowerCase();
  return CURATED_ANSATZ_PACKAGES.find((pkg) => pkg.name.toLowerCase() === norm);
}

/**
 * Scans Modelica source for external root package identifiers (imports and qualified type references)
 * that are neither built into Modelica (MSL) nor declared locally within the file.
 */
export function scanExternalNamespaceCandidates(source: string, locallyDeclaredClasses: string[] = []): string[] {
  const code = stripNonCode(source);
  const localSet = new Set(
    locallyDeclaredClasses.map((cls) => {
      const root = cls.split(".")[0]!;
      return root.replace(/^'|'$/g, "").toLowerCase();
    }),
  );

  const candidateRoots = new Set<string>();

  // 1. Scan for `import [Name = ] Root.Sub...;` or `import Root;`
  const importRegex = /\bimport\s+(?:[A-Za-z_]\w*\s*=\s*)?([A-Za-z_]\w*)/g;
  let impMatch: RegExpExecArray | null;
  while ((impMatch = importRegex.exec(code)) !== null) {
    const root = impMatch[1]!;
    const lower = root.toLowerCase();
    if (!BUILTIN_NAMESPACES.has(lower) && !localSet.has(lower)) {
      candidateRoots.add(root);
    }
  }

  // 2. Scan for full dotted chains `Root.Child[.Grandchild...]` not preceded by dot
  const chainRegex = /(?:^|[^\w.])([A-Za-z_]\w*)(?:\.[A-Za-z_]\w+)+/g;
  let chMatch: RegExpExecArray | null;
  while ((chMatch = chainRegex.exec(code)) !== null) {
    const root = chMatch[1]!;
    const lower = root.toLowerCase();
    if (!BUILTIN_NAMESPACES.has(lower) && !localSet.has(lower)) {
      // Keep if known curated package or explicitly looks like a package reference
      if (findCuratedPackage(root) || candidateRoots.has(root)) {
        candidateRoots.add(root);
      }
    }
  }

  return Array.from(candidateRoots);
}

/**
 * Queries package metadata (versions, description) from local curated list or registry API if available.
 */
export async function resolvePackageInfo(
  packageName: string,
  preferredVersion?: string,
): Promise<{
  version: string;
  versions: string[];
  description?: string;
  verified?: boolean;
  existsInRegistry?: boolean;
}> {
  const curated = findCuratedPackage(packageName);
  let versions = curated?.versions ? [...curated.versions] : curated ? [curated.version] : [];
  let defaultVer = preferredVersion || curated?.version || "1.0.0";
  let description = curated?.description ?? undefined;
  let verified = curated?.verified ?? false;
  let existsInRegistry = Boolean(curated);

  if (typeof fetch !== "undefined") {
    try {
      const resp = await fetch(`/api/v1/libraries/${encodeURIComponent(packageName)}`);
      if (resp.ok) {
        existsInRegistry = true;
        const meta = await resp.json();
        if (Array.isArray(meta?.versions)) {
          const fetchedVersions = meta.versions
            .map((v: { version?: string }) => v.version)
            .filter((v: unknown): v is string => typeof v === "string" && Boolean(v));
          if (fetchedVersions.length > 0) {
            versions = fetchedVersions;
          }
        }
        if (meta?.latest_version && !preferredVersion) {
          defaultVer = meta.latest_version;
        }
        if (typeof meta?.description === "string" && meta.description) {
          description = meta.description;
        }
        if (typeof meta?.verified === "boolean") {
          verified = meta.verified;
        }
      }
    } catch {
      // Offline or registry endpoint unavailable, retain curated defaults
    }
  }

  if (preferredVersion && !versions.includes(preferredVersion)) {
    versions.unshift(preferredVersion);
  }
  if (!versions.includes(defaultVer)) {
    versions.push(defaultVer);
  }

  return { version: defaultVer, versions, description, verified, existsInRegistry };
}

/**
 * Detects all external library dependencies for a Modelica source string, combining
 * explicit `annotation(uses(...))` clauses and inferred external package namespaces.
 */
export async function detectModelicaDependencies(
  source: string,
  locallyDeclaredClasses: string[] = [],
): Promise<ArtifactLibraryDependency[]> {
  const results: ArtifactLibraryDependency[] = [];
  const seen = new Set<string>();

  // 1. Explicit uses(...) annotations
  const declared = extractModelicaUsesDependencies(source);
  for (const dep of declared) {
    if (BUILTIN_NAMESPACES.has(dep.name.toLowerCase())) continue;
    seen.add(dep.name.toLowerCase());
    const info = await resolvePackageInfo(dep.name, dep.version);
    results.push({
      name: dep.name,
      version: dep.version,
      autoDetected: true,
      resolvedFrom: "uses-annotation",
      description: info.description,
      verified: info.verified,
      availableVersions: info.versions,
    });
  }

  // 2. Candidate namespaces from imports and qualified references
  const candidates = scanExternalNamespaceCandidates(source, locallyDeclaredClasses);
  for (const candidate of candidates) {
    if (seen.has(candidate.toLowerCase())) continue;
    seen.add(candidate.toLowerCase());

    const curated = findCuratedPackage(candidate);
    const info = await resolvePackageInfo(candidate);
    // Only include if curated or confirmed in registry
    if (curated || info.existsInRegistry) {
      results.push({
        name: curated?.name ?? candidate,
        version: info.version,
        autoDetected: true,
        resolvedFrom: "ast-identifier",
        description: info.description,
        verified: info.verified,
        availableVersions: info.versions,
      });
    }
  }

  return results;
}

const SYSML_BUILTIN_NAMESPACES = new Set<string>([
  "scalarvalues",
  "isq",
  "isqbase",
  "si",
  "quantities",
  "time",
  "analysistooling",
  "kerml",
  "base",
  "control",
  "calculations",
  "collections",
  "shapes",
  "views",
  "numericalfunctions",
  "standardviewdefinitions",
  "causeandeffect",
  "actions",
  "states",
  "occurrences",
]);

/**
 * Extracts candidate external library identifiers from SysML v2 source code (.sysml, .kerml).
 * Detects `import PackageName::*`, `import PackageName::Element`, and namespace qualifiers.
 */
export function extractSysmlDependencies(source: string, locallyDeclaredPackages: string[] = []): string[] {
  const code = stripNonCode(source);
  const candidates = new Set<string>();
  const localSet = new Set(locallyDeclaredPackages.map((p) => p.trim().toLowerCase()));

  // 1. Scan `import <RootPackage>[::...];`
  const importRe = /\bimport\s+([A-Za-z_]\w*)(?:::|\s*;|\s+as\b)/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(code)) !== null) {
    const root = m[1]!;
    const lower = root.toLowerCase();
    if (!SYSML_BUILTIN_NAMESPACES.has(lower) && !localSet.has(lower)) {
      candidates.add(root);
    }
  }

  // 2. Scan qualified identifiers `RootPackage::Sub`
  const qualifyRe = /(?:^|[^\w:])([A-Za-z_]\w*)::[A-Za-z_]/g;
  while ((m = qualifyRe.exec(code)) !== null) {
    const root = m[1]!;
    const lower = root.toLowerCase();
    if (!SYSML_BUILTIN_NAMESPACES.has(lower) && !localSet.has(lower)) {
      if (findCuratedPackage(root) || candidates.has(root)) {
        candidates.add(root);
      }
    }
  }

  return Array.from(candidates);
}

function stripSpiceComments(source: string): string {
  return source.replace(/^[ \t]*\*.*$/gm, "").replace(/;.*$/gm, "");
}

/**
 * Extracts candidate external library and include files from SPICE netlists (.cir, .sp, .spice).
 * Detects `.include "<file>"` and `.lib "<file>" <section>`.
 */
export function extractSpiceDependencies(source: string): string[] {
  const code = stripSpiceComments(source);
  const candidates = new Set<string>();

  // Scan `.include <file>` or `.lib <file>`
  const incRe = /^[ \t]*\.(?:include|lib)\s+["']?([^"'\s\r\n]+)["']?/gim;
  let m: RegExpExecArray | null;
  while ((m = incRe.exec(code)) !== null) {
    const fileTarget = m[1]!.trim();
    if (!fileTarget) continue;
    const base = fileTarget.split(/[/\\]/).pop() || fileTarget;
    const nameWithoutExt = base.replace(/\.(cir|sp|spice|lib|mod|va|net)$/i, "");
    if (nameWithoutExt.length > 0) {
      candidates.add(nameWithoutExt);
    }
  }

  return Array.from(candidates);
}

/**
 * Detects all external library dependencies for any supported polyglot language source,
 * cross-referencing against the Ansatz Package Registry and curated packages.
 */
export async function detectPolyglotDependencies(
  source: string,
  languageOrExt: string,
  locallyDeclaredClasses: string[] = [],
): Promise<ArtifactLibraryDependency[]> {
  const norm = languageOrExt.toLowerCase().replace(/^\./, "").trim();

  if (norm === "mo" || norm === "modelica") {
    return detectModelicaDependencies(source, locallyDeclaredClasses);
  }

  const results: ArtifactLibraryDependency[] = [];
  const seen = new Set<string>();

  let candidateNames: string[] = [];
  if (norm === "sysml" || norm === "sysml2" || norm === "kerml") {
    candidateNames = extractSysmlDependencies(source, locallyDeclaredClasses);
  } else if (norm === "cir" || norm === "sp" || norm === "spice" || norm === "va") {
    candidateNames = extractSpiceDependencies(source);
  } else {
    candidateNames = scanExternalNamespaceCandidates(source, locallyDeclaredClasses);
  }

  for (const candidate of candidateNames) {
    if (seen.has(candidate.toLowerCase())) continue;
    seen.add(candidate.toLowerCase());

    const curated = findCuratedPackage(candidate);
    const info = await resolvePackageInfo(candidate);
    if (curated || info.existsInRegistry) {
      results.push({
        name: curated?.name ?? candidate,
        version: info.version,
        autoDetected: true,
        resolvedFrom: "ast-identifier",
        description: info.description,
        verified: info.verified,
        availableVersions: info.versions,
      });
    }
  }

  return results;
}
