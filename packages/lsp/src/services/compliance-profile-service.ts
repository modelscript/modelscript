// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry, type LoadedLibraryPackage, type SysmlRequirement } from "@modelscript/runtime";
import { mountedLibraryMetadata, normalizeLibraryName } from "../utils/hierarchy-utils.js";

export interface SysmlDocSource {
  uri: string;
  text: string;
}

export interface TaggedSysmlRequirement {
  req: SysmlRequirement;
  sourceUri?: string | undefined;
}

export interface ActiveComplianceResolution {
  activePackages: Set<string>;
  explicitDisabledPackages: Set<string>;
  activeStandardCodes: Set<string>;
  activeNamespaces: Set<string>;
  importedNamespaces: Set<string>;
  referencedTokens: Set<string>;
  declaredProjectStandards: Set<string>;
}

function collectDeclaredProjectStandards(
  packageJsonTexts: readonly string[],
  modelText: string,
  allSysmlDocs: readonly SysmlDocSource[],
): Set<string> {
  const out = new Set<string>();

  for (const rawJson of packageJsonTexts) {
    try {
      const parsed = JSON.parse(rawJson) as { modelscript?: { standards?: unknown } };
      const stds = parsed?.modelscript?.standards;
      if (Array.isArray(stds)) {
        for (const s of stds) {
          if (typeof s === "string" && s.trim()) {
            out.add(normalizeLibraryName(s.trim()));
            out.add(s.trim().toLowerCase());
          }
        }
      }
    } catch {
      // ignore malformed package.json while user is typing
    }
  }

  for (const pkg of [
    ...globalLibraryRegistry.getStandardPacks(),
    ...globalLibraryRegistry.getPackagesForLanguage("sysml2"),
    ...globalLibraryRegistry.getPackagesForLanguage("modelica"),
  ]) {
    const stds = (pkg.manifest as { standards?: unknown }).standards;
    if (Array.isArray(stds)) {
      for (const s of stds) {
        if (typeof s === "string" && s.trim()) {
          out.add(normalizeLibraryName(s.trim()));
          out.add(s.trim().toLowerCase());
        }
      }
    }
  }

  const scanProfileAnnotations = (src: string): void => {
    const profileRe = /@(?:ComplianceProfile|Standard)\s*\(\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = profileRe.exec(src)) !== null) {
      if (m[1]) {
        out.add(normalizeLibraryName(m[1]));
        out.add(m[1].toLowerCase());
      }
    }
  };
  scanProfileAnnotations(modelText);
  for (const doc of allSysmlDocs) {
    scanProfileAnnotations(doc.text);
  }

  return out;
}

function collectImportsAndReferences(
  modelText: string,
  allSysmlDocs: readonly SysmlDocSource[],
  twinAnnotations?: ReadonlyMap<string, string>,
): { importedNamespaces: Set<string>; referencedTokens: Set<string> } {
  const importedNamespaces = new Set<string>();
  const referencedTokens = new Set<string>();

  const scanText = (text: string, isSysml: boolean): void => {
    const importRe = /\bimport\s+([a-zA-Z0-9_.:*]+)/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(text)) !== null) {
      const target = m[1]!;
      const rootNs = target.split("::")[0]?.split(".")[0]?.trim();
      if (rootNs) {
        importedNamespaces.add(rootNs);
        importedNamespaces.add(rootNs.toLowerCase());
      }
    }

    if (isSysml) {
      const sysmlRefRe = /(?:\b(?:satisfy|verify)\s+|:\s*|::)([a-zA-Z0-9_.:]+)/g;
      let rm: RegExpExecArray | null;
      while ((rm = sysmlRefRe.exec(text)) !== null) {
        const tok = rm[1]!;
        for (const seg of tok.split(/::|\./)) {
          if (seg) referencedTokens.add(seg.toLowerCase());
        }
      }
    }

    const twinRe = /\b(?:twin|counterpart|implements)\s*=\s*["']([^"']+)["']/g;
    let tm: RegExpExecArray | null;
    while ((tm = twinRe.exec(text)) !== null) {
      for (const seg of tm[1]!.split(/::|\./)) {
        if (seg) referencedTokens.add(seg.toLowerCase());
      }
    }
  };

  scanText(modelText, false);
  for (const doc of allSysmlDocs) {
    // Only scan user workspace SysML files (not stdlib/standard-pack internal files) as consumer references
    if (!doc.uri.includes("modelscript-stdlib://") && !doc.uri.includes("modelscript-stdpack://")) {
      scanText(doc.text, true);
    }
  }

  if (twinAnnotations) {
    for (const target of twinAnnotations.values()) {
      for (const seg of target.split(/::|\./)) {
        if (seg) referencedTokens.add(seg.toLowerCase());
      }
    }
  }

  return { importedNamespaces, referencedTokens };
}

function findPackForRequirement(
  req: SysmlRequirement,
  sourceUri: string | undefined,
): LoadedLibraryPackage | undefined {
  const packs = globalLibraryRegistry.getStandardPacks();
  for (const pack of packs) {
    const stdMeta = pack.manifest.standard;
    if (sourceUri && sourceUri.includes(pack.packageName)) return pack;
    if (req.packageName && stdMeta?.namespaces?.includes(req.packageName)) return pack;
    if (
      req.standardClause?.standard &&
      stdMeta?.code &&
      normalizeLibraryName(req.standardClause.standard) === normalizeLibraryName(stdMeta.code)
    ) {
      return pack;
    }
  }
  return undefined;
}

/**
 * Resolves which standard packs and compliance profiles are active for the given
 * Modelica/SysML document based on workspace manifests, explicit LSP UI toggles,
 * `import` statements, `: Type` usages, and `@twin` / `@ComplianceProfile` tags.
 */
export function resolveActiveComplianceProfiles(params: {
  modelText: string;
  allSysmlDocs: readonly SysmlDocSource[];
  packageJsonTexts?: readonly string[] | undefined;
  twinAnnotations?: ReadonlyMap<string, string> | undefined;
  activeStandardOverrides?: ReadonlyMap<string, boolean> | undefined;
}): ActiveComplianceResolution {
  const activePackages = new Set<string>();
  const explicitDisabledPackages = new Set<string>();
  const activeStandardCodes = new Set<string>();
  const activeNamespaces = new Set<string>();

  const declaredProjectStandards = collectDeclaredProjectStandards(
    params.packageJsonTexts ?? [],
    params.modelText,
    params.allSysmlDocs,
  );
  const { importedNamespaces, referencedTokens } = collectImportsAndReferences(
    params.modelText,
    params.allSysmlDocs,
    params.twinAnnotations,
  );

  for (const pack of globalLibraryRegistry.getStandardPacks()) {
    const normName = normalizeLibraryName(pack.packageName);
    const stdMeta = pack.manifest.standard;
    const codeNorm = stdMeta?.code ? normalizeLibraryName(stdMeta.code) : undefined;
    const profileNorm = stdMeta?.profile ? normalizeLibraryName(stdMeta.profile) : undefined;
    const mountedInfo = mountedLibraryMetadata.get(normName);

    const explicitOverride =
      params.activeStandardOverrides?.get(normName) ?? params.activeStandardOverrides?.get(pack.packageName);

    if (explicitOverride === false) {
      explicitDisabledPackages.add(normName);
      continue;
    }

    const enabledByDeclaration =
      (codeNorm &&
        (declaredProjectStandards.has(codeNorm) || declaredProjectStandards.has(stdMeta!.code.toLowerCase()))) ||
      (profileNorm &&
        (declaredProjectStandards.has(profileNorm) || declaredProjectStandards.has(stdMeta!.profile!.toLowerCase()))) ||
      declaredProjectStandards.has(normName) ||
      declaredProjectStandards.has(pack.packageName.toLowerCase());

    const enabledByWorkspaceDefault = stdMeta?.activation === "workspace";
    const enabledByOverride = explicitOverride === true || mountedInfo?.active === true;

    if (enabledByOverride || enabledByWorkspaceDefault || enabledByDeclaration) {
      activePackages.add(normName);
      if (stdMeta?.code) activeStandardCodes.add(stdMeta.code.toLowerCase());
      for (const ns of stdMeta?.namespaces ?? []) activeNamespaces.add(ns.toLowerCase());
    }
  }

  for (const [key, info] of mountedLibraryMetadata.entries()) {
    if (info.category === "standard-pack" || info.standardCode) {
      const explicitOverride = params.activeStandardOverrides?.get(key);
      if (explicitOverride === false) {
        explicitDisabledPackages.add(key);
      } else if (explicitOverride === true || info.active === true || info.activation === "workspace") {
        activePackages.add(key);
        if (info.standardCode) activeStandardCodes.add(info.standardCode.toLowerCase());
      }
    }
  }

  return {
    activePackages,
    explicitDisabledPackages,
    activeStandardCodes,
    activeNamespaces,
    importedNamespaces,
    referencedTokens,
    declaredProjectStandards,
  };
}

/**
 * Filters parsed SysML v2 requirements so project-local requirements always run while
 * mounted standard-pack rules only evaluate when activated by profile toggle,
 * workspace manifest, `import`, `@twin`, or specialization references.
 */
export function filterRequirementsForModel(
  tagged: readonly TaggedSysmlRequirement[],
  resolution: ActiveComplianceResolution,
): SysmlRequirement[] {
  const result: SysmlRequirement[] = [];
  const dedup = new Set<string>();

  for (const { req, sourceUri } of tagged) {
    const dedupKey = `${req.packageName ?? ""}::${req.id}::${req.targetAttribute}::${req.expressionText ?? req.limitValue}`;
    if (dedup.has(dedupKey)) continue;

    const pack = findPackForRequirement(req, sourceUri);
    const isStandardPackUri = Boolean(sourceUri && sourceUri.includes("modelscript-stdpack://"));
    const isStandardRule = Boolean(pack || isStandardPackUri || req.standardClause);

    if (isStandardRule) {
      const normPackName = pack ? normalizeLibraryName(pack.packageName) : undefined;
      if (normPackName && resolution.explicitDisabledPackages.has(normPackName)) {
        continue;
      }

      const stdLower = req.standardClause?.standard?.toLowerCase();
      const pkgLower = req.packageName?.toLowerCase();

      const activeByProfile =
        (normPackName && resolution.activePackages.has(normPackName)) ||
        (stdLower &&
          (resolution.activeStandardCodes.has(stdLower) ||
            resolution.declaredProjectStandards.has(stdLower) ||
            resolution.declaredProjectStandards.has(normalizeLibraryName(req.standardClause!.standard!)))) ||
        (pkgLower && resolution.activeNamespaces.has(pkgLower));

      const activeByImport =
        Boolean(pkgLower && resolution.importedNamespaces.has(pkgLower)) ||
        Boolean(pack?.manifest.standard?.namespaces?.some((ns) => resolution.importedNamespaces.has(ns.toLowerCase())));

      const activeByRef =
        resolution.referencedTokens.has(req.id.toLowerCase()) ||
        (req.subjectName !== undefined && resolution.referencedTokens.has(req.subjectName.toLowerCase())) ||
        (pkgLower !== undefined && resolution.referencedTokens.has(pkgLower));

      if (!activeByProfile && !activeByImport && !activeByRef) {
        continue;
      }
    }

    dedup.add(dedupKey);
    result.push(req);
  }

  return result;
}

export function computeRequirementsFingerprint(reqs: readonly SysmlRequirement[]): string {
  if (reqs.length === 0) return "none";
  return reqs
    .map((r) => `${r.packageName ?? ""}:${r.id}:${r.targetAttribute}:${r.operator}:${r.expressionText ?? r.limitValue}`)
    .sort()
    .join("|");
}
