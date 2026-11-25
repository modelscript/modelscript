// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { Cst } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { isPredefinedType } from "../../../predefined-types.js";
import { getShortClassSpecifierNode } from "../../../queries.js";
import type { ModelicaFlattener } from "../../class-flattener.js";
import { generateArrayIndices, getSymbolQualifiedName } from "../../expressions/index.js";
import type { ComponentInstanceData } from "../../types.js";
import { collectExtendsMods } from "../component-inst.js";
import type {
  BreakContext,
  EffectiveModLike,
  EquationCstNode,
  EquationParentMods,
  ExtractClassEquationsFn,
  ModArgLike,
  NameOrIdResolverFn,
  SymbolMetaLike,
} from "./types.js";

export function extractComponentSubEquations(
  flattener: ModelicaFlattener,
  db: QueryDB,
  classId: SymbolId,
  prefix: string,
  dae: DAEBuilder,
  curBreakContext: BreakContext,
  parentMods: EquationParentMods | undefined,
  curVisited: Set<SymbolId>,
  extractClassEquationsFn: ExtractClassEquationsFn,
): SymbolEntry[] {
  const children = db.childrenOf(classId);
  for (const child of children) {
    if (child.kind === "Component") {
      if (curBreakContext.brokenComponents.has(child.name)) {
        continue;
      }
      const compInst = db.query<ComponentInstanceData>("componentInstance", child.id);
      if (compInst?.isOuter && !compInst?.isInner && compInst.causality !== "output") {
        continue;
      }
      const childMeta = child.metadata as SymbolMetaLike | undefined;
      const typeSpec = compInst?.typeSpecifier ?? childMeta?.typeSpecifier ?? childMeta?.type_specifier;
      if (typeSpec === "Real" || typeSpec === "Integer" || typeSpec === "Boolean" || typeSpec === "String") {
        continue;
      }
      let compClassId = db.query<SymbolId | null>("classInstance", child.id);
      let redeclPkgId: SymbolId | null = null;
      let redeclPkgPrefix: string | null = null;
      if (typeSpec?.includes(".")) {
        const typeParts = typeSpec.split(".");
        const pkgPrefix = typeParts[0]!;
        let pkgRedeclArg = parentMods?.args
          ?.slice()
          .reverse()
          .find((a) => !a.isBreak && a.name === pkgPrefix && (a.isRedeclaration || a.redeclaredTypeSpecifier));
        const visitedRedeclNames = new Set<string>();
        while (
          pkgRedeclArg?.redeclaredTypeSpecifier &&
          !pkgRedeclArg.redeclaredTypeSpecifier.includes(".") &&
          !visitedRedeclNames.has(pkgRedeclArg.redeclaredTypeSpecifier)
        ) {
          visitedRedeclNames.add(pkgRedeclArg.redeclaredTypeSpecifier);
          const nextArg = parentMods?.args
            ?.slice()
            .reverse()
            .find(
              (a) =>
                !a.isBreak &&
                a.name === pkgRedeclArg!.redeclaredTypeSpecifier &&
                (a.isRedeclaration || a.redeclaredTypeSpecifier),
            );
          if (nextArg) pkgRedeclArg = nextArg;
          else break;
        }
        if (pkgRedeclArg?.redeclaredTypeSpecifier) {
          const targetPkgId = flattener.resolveRedeclarationType(
            pkgRedeclArg.ownerClassId ?? pkgRedeclArg.evaluationScopeId ?? parentMods?.ownerClassId ?? classId,
            pkgRedeclArg.redeclaredTypeSpecifier,
          );
          if (targetPkgId !== null && targetPkgId !== undefined) {
            let resolvedTargetPkgId: SymbolId = targetPkgId;
            const visitedAliases = new Set<SymbolId>();
            while (!visitedAliases.has(resolvedTargetPkgId)) {
              visitedAliases.add(resolvedTargetPkgId);
              if (
                !getShortClassSpecifierNode(
                  db.cstNode(resolvedTargetPkgId) as Parameters<typeof getShortClassSpecifierNode>[0],
                )
              ) {
                break;
              }
              const basePkg: SymbolEntry | null = db.query<SymbolEntry | null>(
                "resolvedBaseClass",
                resolvedTargetPkgId,
              );
              if (basePkg) resolvedTargetPkgId = basePkg.id;
              else break;
            }
            redeclPkgId = resolvedTargetPkgId;
            redeclPkgPrefix = pkgPrefix;
            const memberName = typeParts.slice(1).join(".");
            const memberTarget =
              db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", resolvedTargetPkgId)?.(memberName) ??
              db.query<(n: string) => SymbolEntry | null>("resolveName", resolvedTargetPkgId)?.(memberName);
            if (
              memberTarget &&
              (memberTarget.kind === "Class" ||
                (memberTarget.metadata as SymbolMetaLike | undefined)?.classKind === "type")
            ) {
              compClassId = memberTarget.id;
            }
          }
        }
      }
      if (!redeclPkgId && classId && typeSpec && child.parentId !== classId) {
        const origClassSym = compClassId ? db.symbol(compClassId) : null;
        if (origClassSym && origClassSym.parentId !== null) {
          const scopeTarget = typeSpec.includes(".")
            ? db.query<(n: string) => SymbolEntry | null>("resolveName", classId)?.(typeSpec)
            : db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", classId)?.(typeSpec);
          const scopeTargetMeta = scopeTarget?.metadata as SymbolMetaLike | undefined;
          if (
            scopeTarget &&
            scopeTarget.id !== compClassId &&
            !scopeTargetMeta?.isPredefined &&
            (scopeTarget.kind === "Class" || scopeTargetMeta?.classKind === "type")
          ) {
            compClassId = scopeTarget.id;
          }
        }
      }
      const matchingClassArg = parentMods?.args?.find(
        (a) =>
          !a.isBreak &&
          a.isRedeclaration &&
          a.redeclaredTypeSpecifier &&
          (a.name === typeSpec || a.name === child.name),
      );
      if (matchingClassArg?.redeclaredTypeSpecifier) {
        const redeclId = flattener.resolveRedeclarationType(
          matchingClassArg.ownerClassId ?? matchingClassArg.evaluationScopeId ?? parentMods?.ownerClassId ?? classId,
          matchingClassArg.redeclaredTypeSpecifier,
        );
        if (redeclId !== null) {
          compClassId = redeclId;
        }
      }
      if (!compClassId) {
        if (typeSpec) {
          try {
            const res =
              db.query<NameOrIdResolverFn | null>("resolveName", classId)?.(typeSpec) ??
              db.query<NameOrIdResolverFn | null>("resolveSimpleName", classId)?.(typeSpec);
            if (res) {
              const s = typeof res === "number" ? db.symbol(res) : res;
              if (s && s.kind === "Class") compClassId = s.id;
            }
          } catch {
            /* ignore unresolved lookup */
          }
          if (!compClassId) {
            const targets = db.byName(typeSpec);
            if (targets.length > 0 && targets[0]!.kind === "Class") {
              compClassId = targets[0]!.id;
            }
          }
        }
      }
      if (compClassId !== null) {
        const resolvedCompClassId: SymbolId | null = flattener.resolveInnerOuterClass(compClassId);
        if (resolvedCompClassId === null) continue;
        const compClassSym = db.symbol(resolvedCompClassId);
        const compClassMeta = compClassSym?.metadata as SymbolMetaLike | undefined;
        const compRawKind = String(compClassMeta?.classKind ?? compClassMeta?.classPrefixes ?? "");
        if (
          compClassSym &&
          compClassSym.kind === "Class" &&
          compRawKind !== "type" &&
          !(
            flattener.pendingArrayBindings.size === 0 &&
            (compRawKind === "record" || compRawKind === "package" || compRawKind === "connector")
          ) &&
          !compClassMeta?.isEnum &&
          !isPredefinedType(compClassSym)
        ) {
          const childPrefix = prefix ? `${prefix}.${child.name}` : child.name;
          if (flattener.isComponentDisabled(childPrefix)) continue;
          const resolveChainedEqRedecl = (
            arg: ModArgLike,
            fallbackScopeId: number | undefined,
            extraMods?: ModArgLike[],
          ): ModArgLike => {
            let effRedeclSpec = arg.redeclaredTypeSpecifier;
            let effOwnerScopeId = arg.ownerClassId ?? arg.evaluationScopeId ?? fallbackScopeId;
            if ((arg.isRedeclaration || effRedeclSpec) && effRedeclSpec) {
              const visitedRedecl = new Set<string>();
              while (effRedeclSpec && !effRedeclSpec.includes(".")) {
                const visitKey = `${effRedeclSpec}@${effOwnerScopeId ?? ""}`;
                if (visitedRedecl.has(visitKey)) break;
                visitedRedecl.add(visitKey);
                const outerRedecl =
                  extraMods
                    ?.slice()
                    .reverse()
                    .find(
                      (pa) =>
                        pa !== arg &&
                        !pa.isBreak &&
                        (pa.isRedeclaration || pa.redeclaredTypeSpecifier) &&
                        pa.name === effRedeclSpec &&
                        pa.redeclaredTypeSpecifier &&
                        (pa.redeclaredTypeSpecifier !== pa.name ||
                          (pa.ownerClassId ?? pa.evaluationScopeId) !== effOwnerScopeId),
                    ) ??
                  parentMods?.args
                    ?.slice()
                    .reverse()
                    .find(
                      (pa) =>
                        pa !== arg &&
                        !pa.isBreak &&
                        (pa.isRedeclaration || pa.redeclaredTypeSpecifier) &&
                        pa.name === effRedeclSpec &&
                        pa.redeclaredTypeSpecifier &&
                        (pa.redeclaredTypeSpecifier !== pa.name ||
                          (pa.ownerClassId ?? pa.evaluationScopeId) !== effOwnerScopeId),
                    );
                if (outerRedecl?.redeclaredTypeSpecifier) {
                  effRedeclSpec = outerRedecl.redeclaredTypeSpecifier;
                  effOwnerScopeId = outerRedecl.ownerClassId ?? outerRedecl.evaluationScopeId ?? effOwnerScopeId;
                } else {
                  break;
                }
              }
              if (!effRedeclSpec.includes(".") && (effOwnerScopeId || classId)) {
                const lookupScopeId = effOwnerScopeId ?? classId;
                const localSym: SymbolEntry | null | undefined =
                  db.query<(n: string) => SymbolEntry | null>("resolveName", lookupScopeId)?.(effRedeclSpec) ??
                  db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", lookupScopeId)?.(effRedeclSpec);
                if (localSym && (localSym.kind === "Class" || localSym.kind === "Package")) {
                  let curSym: SymbolEntry | null = localSym;
                  const visitedAliases = new Set<SymbolId>();
                  while (curSym && !visitedAliases.has(curSym.id)) {
                    visitedAliases.add(curSym.id);
                    const curCst = db.cstNode(curSym.id) as EquationCstNode | null;
                    if (!getShortClassSpecifierNode(curCst)) break;
                    if (
                      db.query<boolean>("isReplaceable", curSym.id) ||
                      curCst?.parent?.type === "element_replaceable"
                    ) {
                      break;
                    }
                    if (db.query<EffectiveModLike | null>("effectiveModification", curSym.id)) break;
                    const curMeta = curSym.metadata as SymbolMetaLike | undefined;
                    if (
                      String(curMeta?.classKind ?? curMeta?.classPrefixes ?? "")
                        .toLowerCase()
                        .includes("type")
                    ) {
                      break;
                    }
                    const nextBase: SymbolEntry | null = db.query<SymbolEntry | null>("resolvedBaseClass", curSym.id);
                    if (nextBase && !(nextBase.metadata as SymbolMetaLike | undefined)?.isPredefined) curSym = nextBase;
                    else break;
                  }
                  if (curSym && curSym.id !== localSym.id) {
                    effRedeclSpec = getSymbolQualifiedName(db, curSym.id) || curSym.name;
                  }
                }
              }
            }
            return {
              ...arg,
              redeclaredTypeSpecifier: effRedeclSpec,
              ownerClassId: effOwnerScopeId,
              evaluationScopeId: effOwnerScopeId,
            };
          };
          const compMods = ((compInst?.modification?.args || []) as ModArgLike[]).map((a) =>
            resolveChainedEqRedecl(a, child.parentId ?? classId),
          );
          const classExtendsMods = (
            (resolvedCompClassId ? collectExtendsMods(flattener, resolvedCompClassId) : []) as ModArgLike[]
          ).map((a) => ({ ...a, ownerClassId: a.ownerClassId ?? resolvedCompClassId }));
          const matchingParentNestedArgs =
            parentMods?.args
              ?.filter((a) => !a.isBreak && a.name === child.name)
              .flatMap((a) =>
                ((a.nestedArgs || a.args || []) as ModArgLike[]).map((na) => ({
                  ...na,
                  ownerClassId: na.ownerClassId ?? a.ownerClassId ?? parentMods?.ownerClassId ?? classId,
                })),
              ) || [];
          const rawChildSubModArgs: ModArgLike[] = [
            ...classExtendsMods,
            ...((matchingClassArg?.nestedArgs || matchingClassArg?.args || []) as ModArgLike[]),
            ...compMods,
            ...matchingParentNestedArgs,
          ];
          const resolvedChildSubModArgs = rawChildSubModArgs.map((a) =>
            (a.isRedeclaration || a.redeclaredTypeSpecifier) && a.redeclaredTypeSpecifier
              ? resolveChainedEqRedecl(a, a.ownerClassId ?? classId, rawChildSubModArgs)
              : a,
          );
          let resolvedChildPkgScopeId: SymbolId | undefined = redeclPkgId ?? parentMods?.packageScopeId;
          let resolvedChildPkgPrefixName: string | undefined = redeclPkgPrefix ?? undefined;
          if (!redeclPkgId && compInst?.typeSpecifier?.includes(".")) {
            const pkgPrefix = compInst.typeSpecifier.split(".")[0]!;
            const concreteScopeId = parentMods?.ownerClassId ?? classId;
            const resolvePkgInScope = (sid?: SymbolId): SymbolEntry | null => {
              if (!sid) return null;
              return (
                db.query<(n: string) => SymbolEntry | null>("resolveName", sid)?.(pkgPrefix) ??
                db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", sid)?.(pkgPrefix) ??
                null
              );
            };
            const pkgSym =
              resolvePkgInScope(concreteScopeId) ??
              (classId !== concreteScopeId ? resolvePkgInScope(classId) : null) ??
              (child.parentId && child.parentId !== concreteScopeId && child.parentId !== classId
                ? resolvePkgInScope(child.parentId)
                : null);
            if (pkgSym && (pkgSym.kind === "Class" || pkgSym.kind === "Package")) {
              let targetPkgId: SymbolId = pkgSym.id;
              const visitedAliases = new Set<SymbolId>();
              while (targetPkgId && !visitedAliases.has(targetPkgId)) {
                visitedAliases.add(targetPkgId);
                const shortCst = db.cstNode(targetPkgId) as Parameters<typeof getShortClassSpecifierNode>[0];
                const specShort = getShortClassSpecifierNode(shortCst);
                if (!specShort) break;
                const basePkg = db.query<SymbolEntry | null>("resolvedBaseClass", targetPkgId);
                if (basePkg) {
                  targetPkgId = basePkg.id;
                  continue;
                }
                const tName = (
                  Cst.ShortClassSpecifier.typeSpecifier(specShort) ??
                  specShort.children?.find((c: { type: string }) => c.type === "type_specifier")
                )?.text?.trim();
                if (tName) {
                  const aliasParentId = db.symbol(targetPkgId)?.parentId ?? concreteScopeId;
                  const aliased =
                    (aliasParentId
                      ? db.query<(n: string) => SymbolEntry | null>("resolveName", aliasParentId)?.(tName)
                      : null) ?? db.byName(tName).find((e) => e.kind === "Class" || e.kind === "Package");
                  if (aliased) {
                    targetPkgId = aliased.id;
                    continue;
                  }
                }
                break;
              }
              resolvedChildPkgScopeId = targetPkgId;
              resolvedChildPkgPrefixName = pkgPrefix;
            }
          }
          const childSpecPkgPrefix =
            resolvedChildPkgScopeId && resolvedChildPkgPrefixName
              ? (() => {
                  const ownerClsId = parentMods?.ownerClassId ?? classId;
                  const ownerQual = ownerClsId ? getSymbolQualifiedName(db, ownerClsId) : "";
                  if (!ownerQual) return undefined;
                  if (!prefix) return `${ownerQual}.${resolvedChildPkgPrefixName}`;
                  if (dae.extensionMetadata?.["isOldFrontend"]) {
                    return `${ownerQual}$${prefix.replaceAll(".", "$")}.${resolvedChildPkgPrefixName}`;
                  }
                  const rootQual = flattener.currentRootClassId
                    ? getSymbolQualifiedName(db, flattener.currentRootClassId)
                    : ownerQual;
                  return `${rootQual}.${prefix}.${resolvedChildPkgPrefixName}`;
                })()
              : parentMods?.specializedPkgPrefix;
          const childSubMod = {
            args: resolvedChildSubModArgs,
            ownerClassId: resolvedCompClassId,
            packageScopeId: resolvedChildPkgScopeId,
            specializedPkgPrefix: childSpecPkgPrefix,
            specializedPkgInstPrefix: resolvedChildPkgScopeId ? prefix : parentMods?.specializedPkgInstPrefix,
          };
          const arrayDims = db.query<number[] | null>("resolvedArrayDimensions", child.id);
          if (curVisited.has(resolvedCompClassId)) {
            continue;
          }
          const nextVisited = new Set(curVisited);
          nextVisited.add(classId);
          if (flattener.options.arrayMode === "preserve") {
            extractClassEquationsFn(
              flattener,
              resolvedCompClassId,
              childPrefix,
              dae,
              curBreakContext,
              childSubMod,
              nextVisited,
            );
          } else if (arrayDims && arrayDims.length > 0) {
            const indices = generateArrayIndices(arrayDims);
            for (const indexStr of indices) {
              if (flattener.isComponentDisabled(`${childPrefix}${indexStr}`)) continue;
              extractClassEquationsFn(
                flattener,
                resolvedCompClassId,
                `${childPrefix}${indexStr}`,
                dae,
                curBreakContext,
                childSubMod,
                nextVisited,
              );
            }
          } else {
            extractClassEquationsFn(
              flattener,
              resolvedCompClassId,
              childPrefix,
              dae,
              curBreakContext,
              childSubMod,
              nextVisited,
            );
          }
        }
      }
    }
  }
  return children;
}

export function extractShortClassAndExtendsEquations(
  flattener: ModelicaFlattener,
  db: QueryDB,
  classId: SymbolId,
  prefix: string,
  dae: DAEBuilder,
  curBreakContext: BreakContext,
  parentMods: EquationParentMods | undefined,
  curVisited: Set<SymbolId>,
  cst: EquationCstNode | null,
  children: SymbolEntry[],
  extractClassEquationsFn: ExtractClassEquationsFn,
): void {
  // If this class is a short class definition (`model Sub = Base(...)`), inherit equations from the base class.
  const specShort = cst
    ? cst._cachedShortSpec !== undefined
      ? cst._cachedShortSpec
      : (cst._cachedShortSpec = getShortClassSpecifierNode(cst) ?? null)
    : null;
  if (specShort) {
    const baseSym = db.query<SymbolEntry | null>("resolvedBaseClass", classId);
    const typeSpec =
      Cst.ShortClassSpecifier.typeSpecifier(specShort) ?? specShort.children?.find((c) => c.type === "type_specifier");
    const typeName = typeSpec?.text?.trim();
    const targetSym =
      baseSym && baseSym.kind === "Class"
        ? baseSym
        : typeName
          ? (db.byName(typeName).find((s) => s.kind === "Class") ?? null)
          : null;
    if (targetSym) {
      const shortMod = db.query<EffectiveModLike | null>("effectiveModification", classId);
      const shortArgs = shortMod?.args ?? [];
      const combinedMods: EquationParentMods = {
        args: [...shortArgs, ...(parentMods?.args ?? [])],
        ownerClassId: parentMods?.ownerClassId ?? classId,
        packageScopeId: parentMods?.packageScopeId,
        specializedPkgPrefix: parentMods?.specializedPkgPrefix,
        specializedPkgInstPrefix: parentMods?.specializedPkgInstPrefix,
      };
      if (!curVisited.has(targetSym.id)) {
        extractClassEquationsFn(flattener, targetSym.id, prefix, dae, curBreakContext, combinedMods, curVisited);
      }
    }
  }

  // Recursively extract equations from `extends` base classes, propagating `break` inheritance
  // modifications (`break_connect:` and broken component names) into `curBreakContext`.
  for (const child of children) {
    if (child.kind === "Extends") {
      const extendsModParsedRaw = db.query<ModArgLike[] | EffectiveModLike | null>(
        "extendsModificationParsed",
        child.id,
      );
      const extendsModParsed: ModArgLike[] = Array.isArray(extendsModParsedRaw)
        ? extendsModParsedRaw
        : (extendsModParsedRaw?.args ?? []);

      const childBrokenComponents = new Set<string>(curBreakContext.brokenComponents);
      const childBrokenConnections = new Set<string>(curBreakContext.brokenConnections);

      for (const arg of extendsModParsed) {
        if (arg.isBreak || arg.value?.kind === "break") {
          if (arg.name.startsWith("break_connect:")) {
            const connStr = arg.name.substring("break_connect:".length);
            childBrokenConnections.add(connStr);
          } else {
            childBrokenComponents.add(arg.name);
          }
        }
      }

      const extSubMod: EquationParentMods = {
        args: [
          ...(extendsModParsed || []).map((a) => ({ ...a, ownerClassId: a.ownerClassId ?? classId })),
          ...(parentMods?.args || []),
        ],
        ownerClassId: parentMods?.ownerClassId ?? classId,
        packageScopeId: parentMods?.packageScopeId,
        specializedPkgPrefix: parentMods?.specializedPkgPrefix,
        specializedPkgInstPrefix: parentMods?.specializedPkgInstPrefix,
      };
      const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
      const baseTargets = baseClass
        ? [baseClass]
        : (() => {
            try {
              const res =
                db.query<NameOrIdResolverFn | null>("resolveName", classId)?.(child.name) ??
                db.query<NameOrIdResolverFn | null>("resolveSimpleName", classId)?.(child.name);
              if (res) {
                const s = typeof res === "number" ? db.symbol(res) : res;
                if (s && s.kind === "Class") return [s];
              }
            } catch {
              /* ignore unresolved lookup */
            }
            return [];
          })();
      for (const target of baseTargets) {
        if (target.kind === "Class") {
          if (curVisited.has(target.id) || target.id === classId) {
            const startB = child.startOffset ?? 0;
            const endB = child.endOffset ?? 0;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.EXTENDS_CYCLE.code,
              message: ModelicaErrorCode.EXTENDS_CYCLE.message(child.name),
              range: {
                startOffset: startB,
                endOffset: endB,
              },
            });
            continue;
          }
          extractClassEquationsFn(
            flattener,
            target.id,
            prefix,
            dae,
            {
              brokenComponents: childBrokenComponents,
              brokenConnections: childBrokenConnections,
            },
            extSubMod,
            curVisited,
          );
        }
      }
    }
  }
}
