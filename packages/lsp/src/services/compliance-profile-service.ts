// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type LoadedLibraryPackage,
  type SymbolIndex,
  type SysmlRequirement,
} from "@modelscript/runtime";
import type { CstNodeLike, CstTreeLike } from "../utils/ast-utils.js";
import { mountedLibraryMetadata, normalizeLibraryName } from "../utils/hierarchy-utils.js";

export interface SysmlDocSource {
  uri: string;
  text: string;
  rootNode?: CstNodeLike | null | undefined;
  tree?: CstTreeLike | null | undefined;
  symbolIndex?: SymbolIndex | null | undefined;
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

const PROFILE_ANNOTATION_RE = /@(?:ComplianceProfile|Standard)\s*\(\s*["']([^"']+)["']/g;
const IMPORT_STMT_RE = /\bimport\s+([a-zA-Z0-9_.:*]+)/g;
const SYSML_REF_RE = /(?:\b(?:satisfy|verify)\s+|:\s*|::)([a-zA-Z0-9_.:]+)/g;
const TWIN_ATTR_RE = /\b(?:twin|counterpart|implements)\s*=\s*["']([^"']+)["']/g;

function unwrapCstRoot(
  nodeOrTree: CstNodeLike | CstTreeLike | { tree?: CstTreeLike | null } | null | undefined,
): CstNodeLike | undefined {
  if (!nodeOrTree || typeof nodeOrTree !== "object") return undefined;
  if ("rootNode" in nodeOrTree && nodeOrTree.rootNode) {
    return nodeOrTree.rootNode;
  }
  if ("tree" in nodeOrTree && nodeOrTree.tree?.rootNode) {
    return nodeOrTree.tree.rootNode;
  }
  if ("type" in nodeOrTree && typeof nodeOrTree.type === "string") {
    return nodeOrTree as CstNodeLike;
  }
  return undefined;
}

function isCommentNodeType(type: string): boolean {
  const lower = type.toLowerCase();
  return (
    lower === "line_comment" ||
    lower === "block_comment" ||
    lower === "doc_comment" ||
    lower === "regular_comment" ||
    lower === "single_line_note" ||
    lower === "multiline_note" ||
    lower === "comment" ||
    lower === "documentation" ||
    lower.endsWith("_comment")
  );
}

function isStringNodeType(type: string): boolean {
  const lower = type.toLowerCase();
  return (
    lower === "string" ||
    lower === "string_literal" ||
    lower === "string_value" ||
    lower === "literal_string" ||
    lower === "description_string"
  );
}

function getCstNodeSpanText(node: CstNodeLike, src: string): string {
  if (
    typeof node.startIndex === "number" &&
    typeof node.endIndex === "number" &&
    node.startIndex >= 0 &&
    node.endIndex > node.startIndex &&
    node.endIndex <= src.length
  ) {
    return src.slice(node.startIndex, node.endIndex);
  }
  return node.text ?? "";
}

function addStandardValue(out: Set<string>, value: string): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  out.add(normalizeLibraryName(trimmed));
  out.add(trimmed.toLowerCase());
}

function addImportedNamespaceTarget(importedNamespaces: Set<string>, target: string): void {
  const rootNs = target.split("::")[0]?.split(".")[0]?.trim();
  if (rootNs) {
    importedNamespaces.add(rootNs);
    importedNamespaces.add(rootNs.toLowerCase());
  }
}

function addReferencedTokenSegments(referencedTokens: Set<string>, raw: string): void {
  for (const seg of raw.split(/::|\./)) {
    const trimmed = seg.trim();
    if (trimmed) referencedTokens.add(trimmed.toLowerCase());
  }
}

function scanProfileAnnotationsText(src: string, out: Set<string>): void {
  PROFILE_ANNOTATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROFILE_ANNOTATION_RE.exec(src)) !== null) {
    if (m[1]) {
      addStandardValue(out, m[1]);
    }
  }
}

function extractProfileAnnotationsFromSymbolIndex(symbolIndex: SymbolIndex, src: string, out: Set<string>): void {
  for (const entry of symbolIndex.symbols.values()) {
    const meta = entry.metadata;
    if (meta) {
      const complianceProfile = meta["complianceProfile"];
      const standard = meta["standard"];
      const profile = meta["profile"];
      if (typeof complianceProfile === "string") addStandardValue(out, complianceProfile);
      if (typeof standard === "string") addStandardValue(out, standard);
      if (typeof profile === "string") addStandardValue(out, profile);
    }

    const ruleLower = entry.ruleName.toLowerCase();
    const isAnnOrMeta =
      entry.kind === "Annotation" ||
      ruleLower.includes("metadata") ||
      ruleLower.includes("annotation") ||
      entry.name === "ComplianceProfile" ||
      entry.name === "Standard";

    if (isAnnOrMeta && entry.startOffset >= 0 && entry.endOffset > entry.startOffset && entry.endOffset <= src.length) {
      scanProfileAnnotationsText(src.slice(entry.startOffset, entry.endOffset), out);
    }
  }
}

function extractProfileAnnotationsFromCst(rootNode: CstNodeLike, src: string, out: Set<string>): void {
  const stack: CstNodeLike[] = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || isCommentNodeType(node.type) || isStringNodeType(node.type)) continue;

    const lower = node.type.toLowerCase();
    if (lower.includes("metadata") || lower.includes("annotation") || node.type === "ERROR") {
      scanProfileAnnotationsText(getCstNodeSpanText(node, src), out);
      if (lower.includes("metadata") || lower.includes("annotation")) {
        continue;
      }
    }

    const children = node.children;
    if (children) {
      for (let i = children.length - 1; i >= 0; i--) {
        const ch = children[i];
        if (ch) stack.push(ch);
      }
    }
  }
}

function extractImportsAndRefsFromSymbolIndex(
  symbolIndex: SymbolIndex,
  src: string,
  isSysml: boolean,
  importedNamespaces: Set<string>,
  referencedTokens: Set<string>,
): void {
  for (const entry of symbolIndex.symbols.values()) {
    const ruleLower = entry.ruleName.toLowerCase();
    const hasSpan = entry.startOffset >= 0 && entry.endOffset > entry.startOffset && entry.endOffset <= src.length;
    const spanText = hasSpan ? src.slice(entry.startOffset, entry.endOffset) : "";
    const meta = entry.metadata;

    if (entry.kind === "Import" || ruleLower === "import_clause" || ruleLower.includes("import")) {
      const importedNs = meta?.["importedNamespace"];
      const importTarget = meta?.["target"];
      if (entry.name) {
        addImportedNamespaceTarget(importedNamespaces, entry.name);
      } else if (typeof importedNs === "string") {
        addImportedNamespaceTarget(importedNamespaces, importedNs);
      } else if (typeof importTarget === "string") {
        addImportedNamespaceTarget(importedNamespaces, importTarget);
      } else if (spanText) {
        IMPORT_STMT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = IMPORT_STMT_RE.exec(spanText)) !== null) {
          if (m[1]) addImportedNamespaceTarget(importedNamespaces, m[1]);
        }
      }
    }

    if (isSysml) {
      const isSysmlRefSymbol =
        entry.ruleName === "SatisfyRequirementUsage" ||
        entry.ruleName === "VerifyRequirementUsage" ||
        entry.ruleName === "OwnedFeatureTyping" ||
        entry.ruleName === "FeatureTyping" ||
        entry.ruleName === "Subclassification" ||
        entry.ruleName === "OwnedSubsetting" ||
        entry.ruleName === "OwnedRedefinition" ||
        ruleLower.includes("satisfy") ||
        ruleLower.includes("verify") ||
        ruleLower.includes("typing") ||
        ruleLower.includes("subclassification");

      if (isSysmlRefSymbol) {
        if (entry.name) addReferencedTokenSegments(referencedTokens, entry.name);
        const refType = meta?.["type"];
        const refTarget = meta?.["target"];
        const refReq = meta?.["requirement"];
        if (typeof refType === "string") addReferencedTokenSegments(referencedTokens, refType);
        if (typeof refTarget === "string") addReferencedTokenSegments(referencedTokens, refTarget);
        if (typeof refReq === "string") addReferencedTokenSegments(referencedTokens, refReq);
        if (spanText) {
          SYSML_REF_RE.lastIndex = 0;
          let rm: RegExpExecArray | null;
          while ((rm = SYSML_REF_RE.exec(spanText)) !== null) {
            if (rm[1]) addReferencedTokenSegments(referencedTokens, rm[1]);
          }
        }
      }
    }

    if (meta) {
      const twin = meta["twin"];
      const counterpart = meta["counterpart"];
      const impl = meta["implements"];
      if (typeof twin === "string") addReferencedTokenSegments(referencedTokens, twin);
      if (typeof counterpart === "string") addReferencedTokenSegments(referencedTokens, counterpart);
      if (typeof impl === "string") addReferencedTokenSegments(referencedTokens, impl);
    }

    if (hasSpan && (ruleLower.includes("annotation") || ruleLower.includes("metadata"))) {
      TWIN_ATTR_RE.lastIndex = 0;
      let tm: RegExpExecArray | null;
      while ((tm = TWIN_ATTR_RE.exec(spanText)) !== null) {
        if (tm[1]) addReferencedTokenSegments(referencedTokens, tm[1]);
      }
    }
  }
}

function extractImportsAndRefsFromCst(
  rootNode: CstNodeLike,
  src: string,
  isSysml: boolean,
  importedNamespaces: Set<string>,
  referencedTokens: Set<string>,
): void {
  const stack: CstNodeLike[] = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || isCommentNodeType(node.type) || isStringNodeType(node.type)) continue;

    const lower = node.type.toLowerCase();

    if (node.type === "import_clause" || node.type === "Import" || lower.includes("import")) {
      const spanText = getCstNodeSpanText(node, src);
      IMPORT_STMT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = IMPORT_STMT_RE.exec(spanText)) !== null) {
        if (m[1]) addImportedNamespaceTarget(importedNamespaces, m[1]);
      }
      continue;
    }

    if (
      isSysml &&
      (node.type === "SatisfyRequirementUsage" ||
        node.type === "VerifyRequirementUsage" ||
        node.type === "OwnedFeatureTyping" ||
        node.type === "FeatureTyping" ||
        node.type === "Subclassification" ||
        node.type === "OwnedSubsetting" ||
        node.type === "OwnedRedefinition" ||
        lower.includes("satisfy") ||
        lower.includes("verify") ||
        lower.includes("typing") ||
        lower.includes("subclassification"))
    ) {
      const spanText = getCstNodeSpanText(node, src);
      SYSML_REF_RE.lastIndex = 0;
      let rm: RegExpExecArray | null;
      while ((rm = SYSML_REF_RE.exec(spanText)) !== null) {
        if (rm[1]) addReferencedTokenSegments(referencedTokens, rm[1]);
      }
    }

    if (lower.includes("annotation") || lower.includes("metadata")) {
      const spanText = getCstNodeSpanText(node, src);
      TWIN_ATTR_RE.lastIndex = 0;
      let tm: RegExpExecArray | null;
      while ((tm = TWIN_ATTR_RE.exec(spanText)) !== null) {
        if (tm[1]) addReferencedTokenSegments(referencedTokens, tm[1]);
      }
      continue;
    }

    const children = node.children;
    if (children) {
      for (let i = children.length - 1; i >= 0; i--) {
        const ch = children[i];
        if (ch) stack.push(ch);
      }
    }
  }
}

function collectDeclaredProjectStandards(
  packageJsonTexts: readonly string[],
  modelText: string,
  allSysmlDocs: readonly SysmlDocSource[],
  modelRootNode?: CstNodeLike | CstTreeLike | null,
  modelSymbolIndex?: SymbolIndex | null,
): Set<string> {
  const out = new Set<string>();

  for (const rawJson of packageJsonTexts) {
    try {
      const parsed = JSON.parse(rawJson) as { modelscript?: { standards?: unknown } };
      const stds = parsed?.modelscript?.standards;
      if (Array.isArray(stds)) {
        for (const s of stds) {
          if (typeof s === "string" && s.trim()) {
            addStandardValue(out, s);
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
          addStandardValue(out, s);
        }
      }
    }
  }

  const collectFromSource = (
    src: string,
    rootNodeOrTree?: CstNodeLike | CstTreeLike | null,
    symbolIndex?: SymbolIndex | null,
  ): void => {
    const cstRoot = unwrapCstRoot(rootNodeOrTree);
    if (symbolIndex) {
      extractProfileAnnotationsFromSymbolIndex(symbolIndex, src, out);
    }
    if (cstRoot) {
      extractProfileAnnotationsFromCst(cstRoot, src, out);
    }
    if (!cstRoot && !symbolIndex) {
      scanProfileAnnotationsText(src, out);
    }
  };

  collectFromSource(modelText, modelRootNode, modelSymbolIndex);
  for (const doc of allSysmlDocs) {
    collectFromSource(doc.text, doc.rootNode ?? doc.tree, doc.symbolIndex);
  }

  return out;
}

function collectImportsAndReferences(
  modelText: string,
  allSysmlDocs: readonly SysmlDocSource[],
  twinAnnotations?: ReadonlyMap<string, string>,
  modelRootNode?: CstNodeLike | CstTreeLike | null,
  modelSymbolIndex?: SymbolIndex | null,
): { importedNamespaces: Set<string>; referencedTokens: Set<string> } {
  const importedNamespaces = new Set<string>();
  const referencedTokens = new Set<string>();

  const scanTextFallback = (text: string, isSysml: boolean): void => {
    IMPORT_STMT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_STMT_RE.exec(text)) !== null) {
      if (m[1]) addImportedNamespaceTarget(importedNamespaces, m[1]);
    }

    if (isSysml) {
      SYSML_REF_RE.lastIndex = 0;
      let rm: RegExpExecArray | null;
      while ((rm = SYSML_REF_RE.exec(text)) !== null) {
        if (rm[1]) addReferencedTokenSegments(referencedTokens, rm[1]);
      }
    }

    TWIN_ATTR_RE.lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = TWIN_ATTR_RE.exec(text)) !== null) {
      if (tm[1]) addReferencedTokenSegments(referencedTokens, tm[1]);
    }
  };

  const collectFromSource = (
    text: string,
    isSysml: boolean,
    rootNodeOrTree?: CstNodeLike | CstTreeLike | null,
    symbolIndex?: SymbolIndex | null,
  ): void => {
    const cstRoot = unwrapCstRoot(rootNodeOrTree);
    if (symbolIndex) {
      extractImportsAndRefsFromSymbolIndex(symbolIndex, text, isSysml, importedNamespaces, referencedTokens);
    }
    if (cstRoot) {
      extractImportsAndRefsFromCst(cstRoot, text, isSysml, importedNamespaces, referencedTokens);
    }
    if (!cstRoot && !symbolIndex) {
      scanTextFallback(text, isSysml);
    }
  };

  collectFromSource(modelText, false, modelRootNode, modelSymbolIndex);
  for (const doc of allSysmlDocs) {
    // Only scan user workspace SysML files (not stdlib/standard-pack internal files) as consumer references
    if (!doc.uri.includes("modelscript-stdlib://") && !doc.uri.includes("modelscript-stdpack://")) {
      collectFromSource(doc.text, true, doc.rootNode ?? doc.tree, doc.symbolIndex);
    }
  }

  if (twinAnnotations) {
    for (const target of twinAnnotations.values()) {
      addReferencedTokenSegments(referencedTokens, target);
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
  modelRootNode?: CstNodeLike | CstTreeLike | null | undefined;
  modelSymbolIndex?: SymbolIndex | null | undefined;
}): ActiveComplianceResolution {
  const activePackages = new Set<string>();
  const explicitDisabledPackages = new Set<string>();
  const activeStandardCodes = new Set<string>();
  const activeNamespaces = new Set<string>();

  const declaredProjectStandards = collectDeclaredProjectStandards(
    params.packageJsonTexts ?? [],
    params.modelText,
    params.allSysmlDocs,
    params.modelRootNode,
    params.modelSymbolIndex,
  );
  const { importedNamespaces, referencedTokens } = collectImportsAndReferences(
    params.modelText,
    params.allSysmlDocs,
    params.twinAnnotations,
    params.modelRootNode,
    params.modelSymbolIndex,
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
