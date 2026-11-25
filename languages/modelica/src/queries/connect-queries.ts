// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Modelica Connect Equation Salsa Queries (`connect_equation` / `ConnectEquation`).
 */

import { error, warning } from "@modelscript/dsl";
import {
  checkPortPlugCompatibility,
  extractPortSignature,
  isMemberLikeSymbol,
  isNamespaceLikeSymbol,
  isPortLikeSymbol,
  isTypeLikeSymbol,
  splitQualifiedPath,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../errors.js";
import type { ModelicaModArgs } from "../modifications.js";
import {
  getSharedTypeRegistry,
  getShortClassSpecifierNode,
  parseConnectRefCst,
  stripTrailingBrackets,
} from "./cst-helpers.js";
import { getSymbolMeta, type ModelicaQueryHooks, type QueryCstNode, type QueryDiagnostic } from "./types.js";

/**
 * Salsa lint hooks attached to `connect_equation` (`ConnectEquation`) symbols.
 */
export const connectEquationQueries: ModelicaQueryHooks = {
  /**
   * Validate that both sides of the connect equation reference
   * connector-typed components, and that they are plug-compatible.
   */
  lint__validateConnect: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    let p = cst?.parent;
    while (p) {
      if (p.type === "inheritance_modification" || p.type === "InheritanceModification") {
        return null;
      }
      p = p.parent;
    }
    let lhsNode = cst ? Cst.ConnectEquation.lhs(cst) : null;
    let rhsNode = cst ? Cst.ConnectEquation.rhs(cst) : null;
    if (!lhsNode || !rhsNode) {
      const children = (cst?.children || []).filter(
        (c: SyntaxNode) => c.type === "component_reference" || c.type === "ComponentReference",
      );
      if (!lhsNode && children.length > 0) lhsNode = children[0] ?? null;
      if (!rhsNode && children.length > 1) rhsNode = children[1] ?? null;
    }

    const meta = getSymbolMeta(self) ?? {};
    const lhsText = lhsNode?.text?.trim() ?? (typeof meta["lhs"] === "string" ? meta["lhs"] : null);
    const rhsText = rhsNode?.text?.trim() ?? (typeof meta["rhs"] === "string" ? meta["rhs"] : null);
    if (!lhsText || !rhsText) return null;

    if (self.parentId === null) return null;
    const parentClassId = self.parentId;
    const parentEntry = db.symbol(parentClassId);
    const parentClassName = parentEntry?.name ?? "";

    const resolveEndpoint = (refText: string) => {
      const rawSegments = splitQualifiedPath(refText);
      let currentClassId: SymbolId = parentClassId;
      let currentEntry: SymbolEntry | null = null;
      let isInsideExpandable = false;

      const compConnectors: boolean[] = [];

      for (let i = 0; i < rawSegments.length; i++) {
        const seg = stripTrailingBrackets(rawSegments[i]!);
        if (!seg) return { resolved: false, missingSegment: rawSegments[i], missingSegmentIndex: i };

        if (i > 0 && db.query<boolean>("isExpandableConnector", currentClassId)) {
          isInsideExpandable = true;
        }

        const resolver = db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", currentClassId);
        let found: SymbolEntry | null = resolver ? resolver(seg) : null;
        if (!found) {
          const allElems = db.query<SymbolEntry[]>("allElements", currentClassId) ?? [];
          found = allElems.find((e) => e.name === seg) ?? null;
        }
        if (!found) {
          if (
            i > 0 &&
            currentEntry?.kind === "Component" &&
            db.query<boolean>("isExpandableConnector", currentClassId)
          ) {
            return {
              resolved: true,
              entry: currentEntry,
              typeClassId: null,
              isConnector: true,
              isExpandable: false,
              isInsideExpandable: true,
              isVirtualExpandableMember: true,
            };
          }
          const fullMissing = rawSegments.slice(0, i + 1).join(".");
          return { resolved: false, missingSegment: fullMissing, missingSegmentIndex: i };
        }

        currentEntry = found;
        const isForeignMember = Boolean(found.language && found.language !== "modelica" && isMemberLikeSymbol(found));
        const isForeignPort = Boolean(found.language && found.language !== "modelica" && isPortLikeSymbol(found));
        if (found.kind === "Component" || isForeignMember) {
          const nextClassId = db.query<SymbolId | null>("classInstance", found.id);
          let isInlineForeignPort = false;
          if (!nextClassId) {
            let typeName = String(
              found.metadata?.["typeSpecifier"] ??
                found.metadata?.["type_specifier"] ??
                found.metadata?.["typeName"] ??
                (isForeignMember ? (db.query<string | null>("typeSpecifier", found.id) ?? "") : ""),
            ).trim();
            if (!typeName && (!found.language || found.language === "modelica")) {
              let cur = db.cstNode(found.id) as SyntaxNode | null | undefined;
              while (cur && cur.type !== "ComponentClause" && cur.type !== "component_clause") {
                cur = cur.parent;
              }
              typeName = cur ? (Cst.ComponentClause.typeSpecifier(cur)?.text?.trim() ?? "") : "";
            }
            const isBuiltinNonConnector =
              typeName === "Real" ||
              typeName === "Integer" ||
              typeName === "Boolean" ||
              typeName === "String" ||
              typeName === "Clock" ||
              typeName === "StateSelect" ||
              typeName === "AssertionLevel" ||
              typeName === "ExternalObject" ||
              Boolean(
                found.language &&
                found.language !== "modelica" &&
                getSharedTypeRegistry().toCanonicalPrimitive(found.language, typeName) !== null,
              );
            isInlineForeignPort = isForeignPort && (!typeName || isBuiltinNonConnector);
            if ((!isBuiltinNonConnector && !isInlineForeignPort) || i < rawSegments.length - 1) {
              const fullMissing = rawSegments.slice(0, i + 1).join(".");
              return { resolved: false, unresolvableType: true, missingSegment: fullMissing, missingSegmentIndex: i };
            }
          }
          const isC =
            (nextClassId ? db.query<boolean>("isConnector", nextClassId) || false : false) || isInlineForeignPort;
          compConnectors.push(isC);
          if (i < rawSegments.length - 1 && nextClassId) {
            currentClassId = nextClassId;
          }
        } else if (
          found.kind === "Class" ||
          found.kind === "Package" ||
          Boolean(
            found.language &&
            found.language !== "modelica" &&
            (isTypeLikeSymbol(found) || isNamespaceLikeSymbol(found)) &&
            !isMemberLikeSymbol(found),
          )
        ) {
          if (i < rawSegments.length - 1) {
            currentClassId = found.id;
          }
        } else {
          if (i < rawSegments.length - 1) {
            const fullMissing = rawSegments.slice(0, i + 1).join(".");
            return { resolved: false, missingSegment: fullMissing, missingSegmentIndex: i };
          }
        }
      }

      if (!currentEntry) return { resolved: false, missingSegment: refText, missingSegmentIndex: 0 };

      const currentIsForeignPort = Boolean(
        currentEntry.language &&
        currentEntry.language !== "modelica" &&
        isPortLikeSymbol(currentEntry) &&
        isMemberLikeSymbol(currentEntry),
      );
      let typeClassId: SymbolId | null = null;
      if (
        currentEntry.kind === "Component" ||
        Boolean(currentEntry.language && currentEntry.language !== "modelica" && isMemberLikeSymbol(currentEntry))
      ) {
        typeClassId = db.query<SymbolId | null>("classInstance", currentEntry.id);
      } else if (
        currentEntry.kind === "Class" ||
        Boolean(
          currentEntry.language &&
          currentEntry.language !== "modelica" &&
          isTypeLikeSymbol(currentEntry) &&
          !isMemberLikeSymbol(currentEntry),
        )
      ) {
        typeClassId = currentEntry.id;
      }

      const isConn =
        (typeClassId ? db.query<boolean>("isConnector", typeClassId) || false : false) || currentIsForeignPort;
      const isExp = typeClassId ? db.query<boolean>("isExpandableConnector", typeClassId) || false : false;
      const invalidForm = compConnectors.length >= 2 && !compConnectors[0] && !compConnectors[1];

      return {
        resolved: true,
        entry: currentEntry,
        typeClassId,
        isConnector: isConn,
        isExpandable: isExp,
        isInsideExpandable,
        invalidForm,
      };
    };

    const lhsRes = resolveEndpoint(lhsText);
    const rhsRes = resolveEndpoint(rhsText);
    const diags: QueryDiagnostic[] = [];

    const getRange = (node: QueryCstNode | null | undefined) => {
      const startOffset = node?.startOffset ?? node?.startIndex ?? self.startOffset;
      const endOffset = node?.endOffset ?? node?.endIndex ?? self.endOffset;
      return { startOffset, endOffset };
    };

    const getSegmentRange = (node: QueryCstNode | null | undefined, refText: string, segIdx: number | undefined) => {
      const base = getRange(node);
      if (segIdx === undefined || !node) return base;
      const idents: QueryCstNode[] = [];
      const collectTopLevelIdents = (n: QueryCstNode | null | undefined) => {
        if (!n) return;
        if (
          n.type === "array_subscripts" ||
          n.type === "ArraySubscripts" ||
          n.type === "subscript" ||
          n.type === "Subscript"
        ) {
          return;
        }
        if (n.type === "identifier" || n.type === "Identifier") {
          idents.push(n);
          return;
        }
        if (n.children) {
          for (const c of n.children) collectTopLevelIdents(c);
        }
      };
      collectTopLevelIdents(node);
      if (segIdx < idents.length) {
        return getRange(idents[segIdx]);
      }
      const rawSegments = refText.split(".");
      if (segIdx < rawSegments.length) {
        const nodeText: string = node?.text ?? refText;
        let searchPos = 0;
        for (let i = 0; i <= segIdx; i++) {
          const rawSeg = rawSegments[i]!;
          const cleanSeg = stripTrailingBrackets(rawSeg);
          const idx = nodeText.indexOf(cleanSeg, searchPos);
          if (idx === -1) break;
          if (i === segIdx) {
            return {
              startOffset: base.startOffset + idx,
              endOffset: base.startOffset + idx + cleanSeg.length,
            };
          }
          searchPos = idx + rawSeg.length + 1;
        }
      }
      return base;
    };

    // 1. Check if endpoints resolve (M2002)
    if (!lhsRes.resolved && !lhsRes.unresolvableType) {
      const dotted = lhsText.includes(".");
      diags.push(
        error(
          ModelicaErrorCode.VARIABLE_NOT_FOUND.message(
            dotted ? lhsText : lhsRes.missingSegment || lhsText,
            parentClassName,
          ),
          {
            ...getSegmentRange(lhsNode, lhsText, lhsRes.missingSegmentIndex),
            code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
          },
        ),
      );
    }
    if (!rhsRes.resolved && !rhsRes.unresolvableType) {
      diags.push(
        error(ModelicaErrorCode.VARIABLE_NOT_FOUND.message(rhsRes.missingSegment || rhsText, parentClassName), {
          ...getSegmentRange(rhsNode, rhsText, rhsRes.missingSegmentIndex),
          code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
        }),
      );
    }
    if (diags.length > 0 || !lhsRes.resolved || !rhsRes.resolved) return diags;

    const checkSubscripts = (refText: string, node: QueryCstNode | null | undefined) => {
      let targetRoot: QueryCstNode | null | undefined = node;
      if ((!targetRoot || !targetRoot.children || targetRoot.children.length === 0) && refText.includes("[")) {
        targetRoot = parseConnectRefCst(refText);
      }
      if (!targetRoot) return null;
      const resolver = db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", parentClassId);
      if (!resolver) return null;

      const subscripts: QueryCstNode[] = [];
      const stack: QueryCstNode[] = [targetRoot];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (cur.type === "subscript" || cur.type === "Subscript") {
          subscripts.push(cur);
          continue;
        }
        const children = cur.children || [];
        for (let i = children.length - 1; i >= 0; i--) {
          if (children[i]) stack.push(children[i]!);
        }
      }

      for (const subNode of subscripts) {
        const subText = subNode.text?.trim() ?? "";
        const idStack: QueryCstNode[] = [subNode];
        while (idStack.length > 0) {
          const cur = idStack.pop()!;
          if (cur.type === "identifier" || cur.type === "Identifier" || cur.type === "IDENT") {
            const idm = cur.text?.trim() ?? "";
            if (idm && idm !== "true" && idm !== "false" && idm !== "end") {
              const sym = resolver(idm);
              if (sym) {
                const vari = db.query<string | null>("variability", sym.id);
                if (vari !== "parameter" && vari !== "constant") {
                  return {
                    invalid: true,
                    subText,
                    refText,
                    range: getRange(node),
                  };
                }
              }
            }
            continue;
          }
          const children = cur.children || [];
          for (let i = children.length - 1; i >= 0; i--) {
            if (children[i]) idStack.push(children[i]!);
          }
        }
      }
      return null;
    };

    const lhsSubErr = checkSubscripts(lhsText, lhsNode);
    if (lhsSubErr) {
      diags.push(
        error(ModelicaErrorCode.CONNECTOR_NON_PARAMETER_SUBSCRIPT.message(lhsText, lhsSubErr.subText), {
          ...lhsSubErr.range,
          code: ModelicaErrorCode.CONNECTOR_NON_PARAMETER_SUBSCRIPT.code,
        }),
      );
      return diags;
    }
    const rhsSubErr = checkSubscripts(rhsText, rhsNode);
    if (rhsSubErr) {
      diags.push(
        error(ModelicaErrorCode.CONNECTOR_NON_PARAMETER_SUBSCRIPT.message(rhsText, rhsSubErr.subText), {
          ...rhsSubErr.range,
          code: ModelicaErrorCode.CONNECTOR_NON_PARAMETER_SUBSCRIPT.code,
        }),
      );
      return diags;
    }
    if (diags.length > 0) return diags;

    const isOldInst = Boolean(
      cst?.tree?.rootNode?.text?.includes("-d=-newInst") ||
      (parentClassId && (db.cstNode(parentClassId) as QueryCstNode | null)?.text?.includes("-d=-newInst")),
    );

    // 2. Check if endpoints are connectors (M3004) or components (M4048)
    if (!isOldInst) {
      if (lhsRes.invalidForm) {
        diags.push(
          error(ModelicaErrorCode.CONNECT_INVALID_FORM.message(lhsText), {
            ...getRange(lhsNode),
            code: ModelicaErrorCode.CONNECT_INVALID_FORM.code,
          }),
        );
        return diags;
      }
      if (rhsRes.invalidForm) {
        diags.push(
          error(ModelicaErrorCode.CONNECT_INVALID_FORM.message(rhsText), {
            ...getRange(rhsNode),
            code: ModelicaErrorCode.CONNECT_INVALID_FORM.code,
          }),
        );
        return diags;
      }

      if (
        lhsRes.entry &&
        (lhsRes.entry.kind === "Class" ||
          (lhsRes.entry.language !== "modelica" &&
            isTypeLikeSymbol(lhsRes.entry) &&
            !isMemberLikeSymbol(lhsRes.entry))) &&
        lhsRes.isConnector
      ) {
        diags.push(
          error(ModelicaErrorCode.CARDINALITY_EXPECTED_COMPONENT.message(lhsText), {
            ...getRange(lhsNode),
            code: ModelicaErrorCode.CARDINALITY_EXPECTED_COMPONENT.code,
          }),
        );
        return diags;
      }
      if (
        rhsRes.entry &&
        (rhsRes.entry.kind === "Class" ||
          (rhsRes.entry.language !== "modelica" &&
            isTypeLikeSymbol(rhsRes.entry) &&
            !isMemberLikeSymbol(rhsRes.entry))) &&
        rhsRes.isConnector
      ) {
        diags.push(
          error(ModelicaErrorCode.CARDINALITY_EXPECTED_COMPONENT.message(rhsText), {
            ...getRange(rhsNode),
            code: ModelicaErrorCode.CARDINALITY_EXPECTED_COMPONENT.code,
          }),
        );
        return diags;
      }

      // Check M4149: connecting two outputs at the same component/class ownership level
      if (lhsRes.entry && rhsRes.entry) {
        const resolveEndpointCausality = (
          entry: SymbolEntry,
          typeClassId: SymbolId | null | undefined,
        ): string | null => {
          const direct = db.query<string | null>("causality", entry.id);
          if (direct) return direct;
          if (typeClassId) {
            const typeCst = db.cstNode(typeClassId) as QueryCstNode | null;
            const spec = getShortClassSpecifierNode(typeCst);
            const basePfx = spec?.children?.find(
              (c: SyntaxNode) => c.type === "base_prefix" || c.type === "type_prefix",
            );
            const txt = basePfx?.text ?? spec?.text ?? "";
            if (/\boutput\b/.test(txt)) return "output";
            if (/\binput\b/.test(txt)) return "input";
          }
          return null;
        };
        const lhsCaus = resolveEndpointCausality(lhsRes.entry, lhsRes.typeClassId);
        const rhsCaus = resolveEndpointCausality(rhsRes.entry, rhsRes.typeClassId);
        if (lhsCaus === "output" && rhsCaus === "output") {
          const lhsIsOwn = lhsRes.entry.parentId === parentClassId;
          const rhsIsOwn = rhsRes.entry.parentId === parentClassId;
          if (lhsIsOwn === rhsIsOwn) {
            diags.push(
              warning(ModelicaErrorCode.CONNECT_TWO_OUTPUTS.message(lhsText, rhsText), {
                ...getRange(cst),
                code: ModelicaErrorCode.CONNECT_TWO_OUTPUTS.code,
              }),
            );
          }
        }
      }

      if (!lhsRes.isConnector && !lhsRes.isExpandable && !lhsRes.isInsideExpandable) {
        diags.push(
          error(ModelicaErrorCode.NOT_A_CONNECTOR.message(lhsText), {
            ...getRange(lhsNode),
            code: ModelicaErrorCode.NOT_A_CONNECTOR.code,
          }),
        );
        return diags;
      }
      if (!rhsRes.isConnector && !rhsRes.isExpandable && !rhsRes.isInsideExpandable) {
        diags.push(
          error(ModelicaErrorCode.NOT_A_CONNECTOR.message(rhsText), {
            ...getRange(rhsNode),
            code: ModelicaErrorCode.NOT_A_CONNECTOR.code,
          }),
        );
        return diags;
      }
    }

    // 3. Expandable connector compatibility (M4055)
    if (lhsRes.isExpandable && !rhsRes.isExpandable && !rhsRes.isInsideExpandable) {
      diags.push(
        error(ModelicaErrorCode.CANNOT_CONNECT_EXPANDABLE_WITH_NON_EXPANDABLE.message(lhsText, rhsText), {
          ...getRange(cst),
          code: ModelicaErrorCode.CANNOT_CONNECT_EXPANDABLE_WITH_NON_EXPANDABLE.code,
        }),
      );
      return diags;
    } else if (rhsRes.isExpandable && !lhsRes.isExpandable && !lhsRes.isInsideExpandable) {
      diags.push(
        error(ModelicaErrorCode.CANNOT_CONNECT_EXPANDABLE_WITH_NON_EXPANDABLE.message(rhsText, lhsText), {
          ...getRange(cst),
          code: ModelicaErrorCode.CANNOT_CONNECT_EXPANDABLE_WITH_NON_EXPANDABLE.code,
        }),
      );
      return diags;
    } else if (lhsRes.isExpandable && rhsRes.isExpandable) {
      return diags.length > 0 ? diags : null;
    }

    // 4. Standard connector plug-compatibility (M3003, M5004)
    if (lhsRes.isInsideExpandable || rhsRes.isInsideExpandable) {
      return diags.length > 0 ? diags : null;
    }

    const lhsTypeEntry = (lhsRes.typeClassId ? db.symbol(lhsRes.typeClassId) : null) ?? null;
    const rhsTypeEntry = (rhsRes.typeClassId ? db.symbol(rhsRes.typeClassId) : null) ?? null;
    const isCrossLangConnect =
      Boolean(lhsRes.entry?.language && lhsRes.entry.language !== "modelica") ||
      Boolean(rhsRes.entry?.language && rhsRes.entry.language !== "modelica") ||
      Boolean(lhsTypeEntry?.language && lhsTypeEntry.language !== "modelica") ||
      Boolean(rhsTypeEntry?.language && rhsTypeEntry.language !== "modelica");

    if (isCrossLangConnect) {
      const lhsPortEntry = lhsRes.entry ?? lhsTypeEntry;
      const rhsPortEntry = rhsRes.entry ?? rhsTypeEntry;
      if (lhsPortEntry && rhsPortEntry) {
        const registry = getSharedTypeRegistry();
        let lhsSig = extractPortSignature(db, lhsPortEntry, { registry });
        if ((!lhsSig || lhsSig.variables.length === 0) && lhsTypeEntry && lhsTypeEntry.id !== lhsPortEntry.id) {
          const typeSig = extractPortSignature(db, lhsTypeEntry, { registry });
          if (typeSig && typeSig.variables.length > 0) lhsSig = typeSig;
        }
        let rhsSig = extractPortSignature(db, rhsPortEntry, { registry });
        if ((!rhsSig || rhsSig.variables.length === 0) && rhsTypeEntry && rhsTypeEntry.id !== rhsPortEntry.id) {
          const typeSig = extractPortSignature(db, rhsTypeEntry, { registry });
          if (typeSig && typeSig.variables.length > 0) rhsSig = typeSig;
        }
        if (lhsSig && rhsSig) {
          const compat = checkPortPlugCompatibility(lhsSig, rhsSig, registry);
          if (!compat.compatible) {
            const isElectricalBoundary = (entry: typeof lhsPortEntry) => {
              const name = (entry.name || "").toLowerCase();
              const rule = (entry.ruleName || "").toLowerCase();
              return (
                rule === "pscad_port" ||
                rule === "pscad_connector" ||
                rule === "psse_component" ||
                name.includes("pin") ||
                name.includes("plug") ||
                name.includes("pcc") ||
                name.includes("bus") ||
                name === "electricalpin"
              );
            };
            if (isElectricalBoundary(lhsPortEntry) && isElectricalBoundary(rhsPortEntry)) {
              return diags.length > 0 ? diags : null;
            }
            diags.push(
              error(
                ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(lhsText, rhsText) +
                  (compat.reason ? ` (${compat.reason})` : ""),
                {
                  ...getRange(cst),
                  code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
                },
              ),
            );
            return diags;
          }
          return diags.length > 0 ? diags : null;
        }
      }
    }

    // 4. Standard connector plug-compatibility (M3003, M5004)
    if (lhsRes.typeClassId && rhsRes.typeClassId) {
      const lhsMod = lhsRes.entry ? db.query<ModelicaModArgs | null>("effectiveModification", lhsRes.entry.id) : null;
      const rhsMod = rhsRes.entry ? db.query<ModelicaModArgs | null>("effectiveModification", rhsRes.entry.id) : null;
      const lhsHasRedecl = Boolean(lhsMod?.args?.some((a) => a.isRedeclaration));
      const rhsHasRedecl = Boolean(rhsMod?.args?.some((a) => a.isRedeclaration));
      const hasRedeclMod = lhsHasRedecl || rhsHasRedecl;
      if (lhsRes.typeClassId === rhsRes.typeClassId && !hasRedeclMod) {
        return diags.length > 0 ? diags : null;
      }
      const lhsElems = (db.query<SymbolEntry[]>("allElements", lhsRes.typeClassId) ?? []).filter(
        (e) => e.kind === "Component",
      );
      const rhsElems = (db.query<SymbolEntry[]>("allElements", rhsRes.typeClassId) ?? []).filter(
        (e) => e.kind === "Component",
      );

      // Check flow matching (M5004)
      const lhsFlowMap = new Map<string, string | null>();
      for (const elem of lhsElems) {
        let flow = db.query<string | null>("flowPrefix", elem.id) ?? null;
        const redecl = lhsMod?.args?.find((a) => a.isRedeclaration && a.name === elem.name);
        if (redecl && redecl.redeclaredPrefix !== undefined) {
          flow = redecl.redeclaredPrefix === "flow" ? "flow" : null;
        }
        lhsFlowMap.set(elem.name, flow);
      }
      const rhsFlowMap = new Map<string, string | null>();
      for (const elem of rhsElems) {
        let flow = db.query<string | null>("flowPrefix", elem.id) ?? null;
        const redecl = rhsMod?.args?.find((a) => a.isRedeclaration && a.name === elem.name);
        if (redecl && redecl.redeclaredPrefix !== undefined) {
          flow = redecl.redeclaredPrefix === "flow" ? "flow" : null;
        }
        rhsFlowMap.set(elem.name, flow);
      }

      for (const [name, lFlow] of lhsFlowMap.entries()) {
        if (rhsFlowMap.has(name)) {
          const rFlow = rhsFlowMap.get(name);
          if (lFlow === "flow" && rFlow !== "flow") {
            diags.push(
              error(ModelicaErrorCode.CONNECT_FLOW_MISMATCH.message(`${lhsText}.${name}`, `${rhsText}.${name}`), {
                ...(hasRedeclMod && isOldInst ? getRange(cst) : getRange(lhsNode)),
                code: ModelicaErrorCode.CONNECT_FLOW_MISMATCH.code,
              }),
            );
          } else if (rFlow === "flow" && lFlow !== "flow") {
            diags.push(
              error(ModelicaErrorCode.CONNECT_FLOW_MISMATCH.message(`${rhsText}.${name}`, `${lhsText}.${name}`), {
                ...(hasRedeclMod && isOldInst ? getRange(cst) : getRange(rhsNode)),
                code: ModelicaErrorCode.CONNECT_FLOW_MISMATCH.code,
              }),
            );
          }
        }
      }
      if (diags.length > 0) {
        if (hasRedeclMod && isOldInst) {
          const formatConnType = (
            typeClassId: SymbolId,
            elems: SymbolEntry[],
            flowMap: Map<string, string | null>,
            mod: ModelicaModArgs | null,
            hasRedecl: boolean,
            compName: string,
          ) => {
            const baseName = db.symbol(typeClassId)?.name ?? "Connector";
            const connName = hasRedecl ? `${baseName}$${compName}` : baseName;
            const sortedElems = [...elems].sort((a, b) => a.name.localeCompare(b.name));
            const lines = sortedElems.map((el) => {
              const fl = flowMap.get(el.name);
              const redecl = mod?.args?.find((a) => a.isRedeclaration && a.name === el.name);
              const elType =
                redecl?.redeclaredTypeSpecifier ?? db.query<string | null>("typeSpecifier", el.id) ?? "Real";
              return `  ${fl === "flow" ? "flow " : ""}${elType} ${el.name};`;
            });
            return `connector ${connName}\n${lines.join("\n")}\nend ${connName};`;
          };
          const lhsTypeDesc = formatConnType(lhsRes.typeClassId, lhsElems, lhsFlowMap, lhsMod, lhsHasRedecl, lhsText);
          const rhsTypeDesc = formatConnType(rhsRes.typeClassId, rhsElems, rhsFlowMap, rhsMod, rhsHasRedecl, rhsText);
          diags.push(
            error(
              `The type of variables \n${lhsText} type:\n${lhsTypeDesc} and \n${rhsText} type:\n${rhsTypeDesc}\nare inconsistent in connect equations.`,
              {
                ...getRange(cst),
                code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
              },
            ),
          );
        }
        return diags;
      }

      // Check number of elements & type compatibility (M3003)
      if (lhsElems.length !== rhsElems.length) {
        diags.push(
          error(ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(lhsText, rhsText), {
            ...getRange(cst),
            code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
          }),
        );
        return diags;
      }

      for (const lElem of lhsElems) {
        const rElem = rhsElems.find((r) => r.name === lElem.name);
        if (!rElem) {
          diags.push(
            error(ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(lhsText, rhsText), {
              ...getRange(cst),
              code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
            }),
          );
          return diags;
        }
        const lType = db.query<string | null>("typeSpecifier", lElem.id);
        const rType = db.query<string | null>("typeSpecifier", rElem.id);
        if (lType && rType && lType !== rType) {
          diags.push(
            error(ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(lhsText, rhsText), {
              ...getRange(cst),
              code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
            }),
          );
          return diags;
        }
      }
    }

    return diags.length > 0 ? diags : null;
  },
};
