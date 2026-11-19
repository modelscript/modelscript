// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared Modelica CST-vs-Salsa diagnostic reconciliation helpers (`I4`).
 *
 * Used by both `@modelscript/lsp` (`ValidationService`) and the OpenModelica
 * testsuite worker (`testsuite-worker.ts`) so single-file WASM CST checks
 * (`M2002` variable-not-found and `M2003` class-not-found) reconcile identically
 * against multi-file `QueryEngine` resolution, imports, `outer`, and
 * expandable connectors.
 */

export interface ReconcileSymbolLike {
  id: number;
  kind: string;
  name: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface ModelicaReconcileView {
  symbols: Iterable<[number, ReconcileSymbolLike]> | Map<number, ReconcileSymbolLike>;
  symbol: (id: number) => ReconcileSymbolLike | undefined;
  byName: (name: string) => ReconcileSymbolLike[];
  query: <T = unknown>(queryName: string, id: number) => T;
}

/**
 * Resolves a Modelica variable / dotted component path (`x`, `port.v`, `bus.speed`)
 * across `Class`/`Package` scopes in `view`, including inherited members, `outer`
 * references, and expandable connector buses.
 */
export function resolveModelicaVariableInWorkspace(
  view: ModelicaReconcileView,
  varName: string,
  scopeName?: string | null,
  preferredScopeIds?: number[],
): boolean {
  if (!varName) return false;
  const firstSeg = varName.includes(".") ? varName.split(".")[0]! : null;
  const candidateIds: number[] = [];
  if (preferredScopeIds && preferredScopeIds.length > 0) {
    candidateIds.push(...preferredScopeIds);
  } else {
    for (const [symId, sym] of view.symbols) {
      if (sym.kind !== "Class" && sym.kind !== "Package") continue;
      if (scopeName && sym.name !== scopeName && !scopeName.endsWith(`.${sym.name}`)) continue;
      candidateIds.push(symId);
    }
  }

  for (const symId of candidateIds) {
    let resolved: ReconcileSymbolLike | null = null;
    if (varName.includes(".")) {
      resolved =
        view.query<((n: string) => ReconcileSymbolLike | null) | undefined>("resolveName", symId)?.(varName) ?? null;
      if (!resolved && firstSeg) {
        let cur =
          view.query<((n: string) => ReconcileSymbolLike | null) | undefined>("resolveSimpleName", symId)?.(firstSeg) ??
          null;
        if (cur) {
          if (
            cur.kind === "Class" ||
            cur.kind === "Package" ||
            cur.kind === "Function" ||
            Boolean(cur.metadata?.["isExpandable"]) ||
            Boolean(view.query<boolean>("isOuter", cur.id))
          ) {
            resolved = cur;
          } else if (cur.kind === "Component") {
            const segs = varName.split(".").slice(1);
            let ok = true;
            let curSym: ReconcileSymbolLike = cur;
            for (const seg of segs) {
              const cleanSeg = seg.replace(/\[.*$/, "");
              const ci = view.query<number | ReconcileSymbolLike | null>("classInstance", curSym.id);
              const rt = ci ? null : view.query<number | ReconcileSymbolLike | null>("resolvedType", curSym.id);
              const clsId: number | null =
                typeof ci === "number"
                  ? ci
                  : ci && typeof ci.id === "number"
                    ? ci.id
                    : typeof rt === "number"
                      ? rt
                      : rt && typeof rt.id === "number"
                        ? rt.id
                        : null;
              if (!clsId) {
                ok = false;
                break;
              }
              const clsSym = view.symbol(clsId);
              if (
                clsSym?.metadata?.["isExpandable"] ||
                /\bexpandable\b/i.test(
                  String(clsSym?.metadata?.["classPrefixes"] ?? clsSym?.metadata?.["classKind"] ?? ""),
                )
              ) {
                ok = true;
                break;
              }
              const nextSym: ReconcileSymbolLike | null =
                view.query<((n: string) => ReconcileSymbolLike | null) | undefined>(
                  "resolveSimpleName",
                  clsId,
                )?.(cleanSeg) ?? null;
              if (!nextSym) {
                ok = false;
                break;
              }
              curSym = nextSym;
            }
            if (ok) resolved = curSym;
          }
        }
      }
    } else {
      resolved =
        view.query<((n: string) => ReconcileSymbolLike | null) | undefined>("resolveSimpleName", symId)?.(varName) ??
        null;
    }
    if (resolved) return true;
  }

  if (firstSeg && view.byName(firstSeg).some((s) => s.kind === "Class" || s.kind === "Package")) {
    return true;
  }
  return false;
}

/**
 * Resolves a Modelica simple or qualified class/type name across `Class`/`Package`
 * scopes and their `qualifiedImports` tables in `view`.
 */
export function resolveModelicaTypeInWorkspace(
  view: ModelicaReconcileView,
  typeName: string,
  preferredScopeIds?: number[],
): boolean {
  if (!typeName) return false;
  const candidateIds: number[] = [];
  if (preferredScopeIds && preferredScopeIds.length > 0) {
    candidateIds.push(...preferredScopeIds);
  } else {
    for (const [symId, sym] of view.symbols) {
      if (sym.kind !== "Class" && sym.kind !== "Package") continue;
      candidateIds.push(symId);
    }
  }

  for (const symId of candidateIds) {
    const resolved = typeName.includes(".")
      ? view.query<((n: string) => ReconcileSymbolLike | null) | undefined>("resolveName", symId)?.(typeName)
      : view.query<((n: string) => ReconcileSymbolLike | null) | undefined>("resolveSimpleName", symId)?.(typeName);
    if (resolved) return true;
    const scopeData = view.query<{ qualifiedImports?: Record<string, unknown> } | undefined>("getScopeData", symId);
    if (scopeData?.qualifiedImports?.[typeName]) return true;
  }
  return false;
}

export interface CstDiagnosticLike {
  code?: number | string | undefined;
  severity?: number | string | undefined;
  message?: string | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface ReconcileDiagLike {
  code?: number | string | undefined;
  severity?: number | string | undefined;
  message?: string | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

/**
 * Single-pass CST lint codes superseded by full Arena/DAE elaboration checks when an Arena result exists.
 */
export const ARENA_SUPERSEDED_CST_CODES = new Set<number>([
  4001, 4022, 4028, 4034, 4039, 4044, 4048, 4124, 4125, 4126, 5045, 6050, 6051, 6052,
]);

export interface ReconcileModelicaCstOptions<T extends CstDiagnosticLike> {
  cstDiags: T[];
  arenaDiags?: ReconcileDiagLike[] | null | undefined;
  hasArenaResult?: boolean | undefined;
  arenaClassKind?: string | undefined;
  engineDiags?: ReconcileDiagLike[] | null | undefined;
  lintDiags?: ReconcileDiagLike[] | null | undefined;
  isOldFrontend?: boolean | undefined;
  view?: ModelicaReconcileView | null | undefined;
  hasVarByName?: ((name: string) => boolean) | undefined;
  preferredScopeIds?: number[] | undefined;
  targetClassRange?: { startOffset: number; endOffset: number } | undefined;
  resolveCharOffset?: ((diag: T) => number | null) | undefined;
  extractVarInfo?: ((diag: T) => { varName?: string | undefined; scopeName?: string | undefined } | null) | undefined;
  extractTypeName?: ((diag: T) => string | undefined) | undefined;
}

function parseDiagCodeNum(code: number | string | undefined): number | undefined {
  if (typeof code === "number") return Number.isFinite(code) ? code : undefined;
  if (typeof code !== "string") return undefined;
  const m = /(\d{3,5})/.exec(code);
  return m ? parseInt(m[1]!, 10) : undefined;
}

/**
 * Shared CST-vs-Arena/Salsa reconciliation filter used by both the OpenModelica testsuite worker
 * and `@modelscript/lsp` (`I4`). Eliminates single-file CST false positives where full multi-file
 * workspace indexing or DAE flattening already resolved or authoritatively diagnosed the construct.
 */
export function reconcileModelicaCstDiagnostics<T extends CstDiagnosticLike>(
  opts: ReconcileModelicaCstOptions<T>,
): T[] {
  const {
    cstDiags,
    arenaDiags,
    hasArenaResult = Boolean(arenaDiags),
    arenaClassKind,
    engineDiags,
    lintDiags,
    isOldFrontend = false,
    view,
    hasVarByName,
    preferredScopeIds,
    targetClassRange,
    resolveCharOffset,
    extractVarInfo,
    extractTypeName,
  } = opts;

  if (!cstDiags.length) return cstDiags;

  const hasCst4033 = cstDiags.some((d) => parseDiagCodeNum(d.code) === 4033);
  const hasCst4017 = cstDiags.some(
    (d) => parseDiagCodeNum(d.code) === 4017 || (d.message ?? "").includes("are not allowed in"),
  );
  const hasLint4033 = (lintDiags ?? []).some((d) => parseDiagCodeNum(d.code) === 4033);
  const hasArena4017 = (arenaDiags ?? []).some((d) => parseDiagCodeNum(d.code) === 4017);
  const hasArenaError = (arenaDiags ?? []).some((d) => d.severity === "error" || d.severity === 1);
  const hasArena2002 = (arenaDiags ?? []).some((d) => {
    const c = parseDiagCodeNum(d.code);
    return c === 2002 || c === 2012 || c === 2015;
  });
  const hasArena2003OrUnresolved = (arenaDiags ?? []).some((d) => {
    const c = parseDiagCodeNum(d.code);
    return c === 2003 || c === 2012 || c === 2013 || c === 2014;
  });
  const hasEngineOrArenaCode = (codeNum: number): boolean =>
    (arenaDiags ?? []).some((d) => parseDiagCodeNum(d.code) === codeNum) ||
    (engineDiags ?? []).some((d) => parseDiagCodeNum(d.code) === codeNum);

  return cstDiags.filter((cd) => {
    const codeNum = parseDiagCodeNum(cd.code);
    const msg = cd.message ?? "";

    if (
      isOldFrontend &&
      (codeNum === 4064 || codeNum === 4039 || codeNum === 4033 || codeNum === 4007 || msg.includes("in record"))
    ) {
      return false;
    }

    if (hasArenaResult && codeNum !== undefined && ARENA_SUPERSEDED_CST_CODES.has(codeNum)) {
      return false;
    }

    if (codeNum === 4006 && (hasCst4033 || hasLint4033)) return false;
    if (codeNum === 4042 && (hasCst4017 || hasArena4017)) return false;
    if (msg.startsWith("Array shape mismatch:")) return false;

    if (codeNum === 4037 && hasArenaResult && (hasEngineOrArenaCode(4037) || !hasArenaError)) {
      return false;
    }
    if (codeNum === 4053 && (arenaDiags ?? []).some((d) => parseDiagCodeNum(d.code) === 4106)) {
      return false;
    }
    if (codeNum === 3009 && hasEngineOrArenaCode(3009)) {
      return false;
    }
    if (
      codeNum === 4031 &&
      (arenaDiags ?? []).some(
        (d) => parseDiagCodeNum(d.code) === 4031 || (d.message ?? "").includes("is out of bounds"),
      )
    ) {
      return false;
    }
    if (
      codeNum === 5004 &&
      (arenaDiags ?? []).some((d) => {
        const c = parseDiagCodeNum(d.code);
        return c === 3003 || c === 5004 || (d.message ?? "").includes("not type compatible");
      })
    ) {
      return false;
    }
    if (
      (codeNum === 4011 || msg.includes("Invalid protected variable")) &&
      (arenaDiags ?? []).some(
        (d) => parseDiagCodeNum(d.code) === 4011 || (d.message ?? "").includes("Invalid protected variable"),
      )
    ) {
      return false;
    }
    if (
      (codeNum === 4020 || msg.includes("time")) &&
      (arenaDiags ?? []).some((d) => parseDiagCodeNum(d.code) === 4020 || Boolean(d.message?.includes("time")))
    ) {
      return false;
    }
    if (codeNum === 4017 && isOldFrontend && msg.includes("in a package")) {
      return false;
    }

    if ((codeNum === 4017 || codeNum === 4042) && targetClassRange && resolveCharOffset) {
      const charOffset = resolveCharOffset(cd);
      if (
        charOffset !== null &&
        (charOffset < targetClassRange.startOffset || charOffset > targetClassRange.endOffset)
      ) {
        return false;
      }
    }

    if (codeNum === 2002) {
      if (hasCst4017) return false;
      const parsed = extractVarInfo?.(cd);
      const varName = parsed?.varName;
      if (varName && (varName === "array" || hasVarByName?.(varName))) {
        return false;
      }
      if (varName && hasArenaResult && !hasArena2002 && view) {
        if (resolveModelicaVariableInWorkspace(view, varName, parsed?.scopeName ?? null, preferredScopeIds)) {
          return false;
        }
      }
      if (
        hasArena2003OrUnresolved ||
        (arenaDiags ?? []).some(
          (d) => (d.message ?? "").startsWith("Variable ") && (d.message ?? "").includes("not found in scope"),
        )
      ) {
        return false;
      }
    }

    if (codeNum === 2003) {
      if (arenaClassKind === "package" && isOldFrontend) return false;
      if (hasArena2003OrUnresolved || hasEngineOrArenaCode(2003)) return false;
      if (view && extractTypeName) {
        const typeName = extractTypeName(cd);
        if (typeName && resolveModelicaTypeInWorkspace(view, typeName, preferredScopeIds)) {
          return false;
        }
      }
    }

    return true;
  });
}
