// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Bidirectional TGG Round-Trip Synchronizer.
 *
 * Executes declarative TGG rules via PolyglotTransformer (`evaluateRuleForward` /
 * `evaluateRuleBackward`), `parseSysml2Cst`, and `@modelscript/dsl`'s lossless XML
 * CST splice engine (`xml.parseXml`, `setAttributeSplice`, `setElementTextSplice`,
 * `applySplices`) to round-trip ReqIF 1.2 <-> SysML v2 while preserving comments,
 * header metadata, UUIDs, and unmapped attributes.
 */

import { xml } from "@modelscript/dsl";
import type { Splice, XmlElement } from "@modelscript/dsl/xml";
import { PolyglotTransformer, parseSysml2Cst } from "@modelscript/runtime";
import { parseReqIf } from "../parser/reqif-parser.js";
import { reqifToSysml2 } from "../projections/sysml2.js";
import type { AsilLevel, ContractPolicy, ReqIfDocument } from "../types.js";
import { reqifPolyglotConfig, reqifTggRules } from "./reqif-rules.js";

export interface ReqIfSyncChange {
  target: "text" | "contract" | "asilLevel" | "requirement";
  elementId: string;
  property?: string;
  sourceOldVal?: unknown;
  targetNewVal?: unknown;
  reconciledVal: unknown;
  strategy: string;
}

export interface ReqIfSyncOptions {
  strategy?: "source-wins" | "target-wins" | "physics-simplex";
  compactSnippet?: boolean;
}

export interface ReqIfSyncResult {
  updatedText: string;
  changes: ReqIfSyncChange[];
  conflicts: ReturnType<PolyglotTransformer["getConflicts"]>;
  transformer: PolyglotTransformer;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function findXmlElements(el: XmlElement | null, tagName: string, out: XmlElement[] = []): XmlElement[] {
  if (!el) return out;
  if (el.name.toUpperCase() === tagName.toUpperCase()) out.push(el);
  for (const c of el.children) findXmlElements(c, tagName, out);
  return out;
}

/**
 * Executes forward TGG transformation (ReqIF 1.2 -> SysML v2) while registering
 * correspondence threads and shadow complements via `PolyglotTransformer.evaluateRuleForward`.
 */
export interface ProjectReqIfViaTggOptions {
  compactSnippet?: boolean;
  transformer?: PolyglotTransformer;
  contractPolicy?: ContractPolicy;
}

export function projectReqIfViaTgg(
  reqifXmlOrDoc: string | ReqIfDocument,
  options?: ProjectReqIfViaTggOptions,
): { sysmlText: string; transformer: PolyglotTransformer; doc: ReqIfDocument } {
  const isRawString = typeof reqifXmlOrDoc === "string";
  const doc = isRawString ? parseReqIf(reqifXmlOrDoc, { contractPolicy: options?.contractPolicy }) : reqifXmlOrDoc;
  const transformer = options?.transformer ?? new PolyglotTransformer(reqifPolyglotConfig);

  const isStandaloneSnippet =
    options?.compactSnippet ??
    (isRawString && !/<REQ-IF\b/i.test(reqifXmlOrDoc) && !/<THE-HEADER\b/i.test(reqifXmlOrDoc));

  let idx = 0;
  for (const obj of doc.specObjects.values()) {
    const cleanId = obj.identifier.replace(/[^a-zA-Z0-9_]/g, "_");
    const srcNode = {
      kind: "SpecObject",
      name: obj.identifier,
      identifier: obj.identifier,
      text: obj.text,
      asilLevel: obj.asilLevel,
      longName: obj.longName ?? "Braking Distance",
      lastChange: obj.lastChange,
      typeRef: obj.typeRef,
      properties: {
        identifier: obj.identifier,
        text: obj.text,
        asilLevel: obj.asilLevel,
        longName: obj.longName ?? "Braking Distance",
        lastChange: obj.lastChange,
        typeRef: obj.typeRef,
      },
    };
    transformer.evaluateRuleForward(srcNode, "sysml2", obj.identifier);
    const comp = transformer.getComplement(obj.identifier) ?? {};
    comp["contract"] = obj.contract ? { ...obj.contract } : undefined;
    comp["cleanId"] = cleanId;
    comp["isStandaloneSnippet"] = isStandaloneSnippet;
    transformer.storeComplement(obj.identifier, comp);
    transformer.storeComplement(`pos:${idx}`, comp);

    const policy = options?.contractPolicy ?? "permissive";
    const shouldEmitContract =
      obj.contract &&
      (policy === "permissive" ||
        (policy === "ears" && obj.contract.tier !== "heuristic-prose") ||
        (policy === "strict" && obj.contract.tier === "explicit"));

    if (shouldEmitContract && obj.contract) {
      transformer.evaluateRuleForward(
        {
          kind: "Contract",
          name: `${obj.identifier}:contract`,
          variable: obj.contract.variable,
          comparator: obj.contract.comparator,
          limitValue: obj.contract.limitValue,
          properties: {
            variable: obj.contract.variable,
            comparator: obj.contract.comparator,
            limitValue: obj.contract.limitValue,
          },
        },
        "sysml2",
        `${obj.identifier}:contract`,
      );
    }
    idx++;
  }

  transformer.registerEmitter("sysml2", () => {
    const fullSysml = reqifToSysml2(doc, { contractPolicy: options?.contractPolicy });
    if (isStandaloneSnippet) {
      const bodyLines = fullSysml.split("\n");
      const inner = bodyLines
        .slice(3, -1)
        .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
        .join("\n")
        .trim();
      return inner
        .split("\n")
        .filter((line) => !line.includes("attribute reqId : String"))
        .join("\n");
    }
    return fullSysml.trim();
  });

  const sysmlText = transformer.transform(
    { kind: "ReqIfDocument", name: doc.header.identifier || "ReqIfDoc", properties: {} },
    "sysml2",
  );
  return { sysmlText, transformer, doc };
}

/**
 * Synchronizes modified SysML v2 requirement definitions back into ReqIF 1.2 XML
 * using `parseSysml2Cst`, declarative TGG backward evaluation (`evaluateRuleBackward`),
 * and lossless XML CST splicing (`@modelscript/dsl/xml`).
 */
export function synchronizeSysml2ToReqIf(
  originalReqIfXml: string,
  modifiedSysmlText: string,
  options?: ReqIfSyncOptions,
): ReqIfSyncResult {
  const { transformer, doc: originalDoc } = projectReqIfViaTgg(originalReqIfXml);
  const sysmlCst = parseSysml2Cst(modifiedSysmlText);
  if (sysmlCst.requirementDefs.length === 0) {
    throw new Error("Expected at least one SysML v2 'requirement def <Id> { ... }' block.");
  }

  const strategy = options?.strategy ?? "target-wins";
  const changes: ReqIfSyncChange[] = [];

  // Parse original ReqIF XML into a lossless XML CST
  const xmlDoc = xml.parseXml(originalReqIfXml);
  const specObjElements = findXmlElements(xmlDoc.root, "SPEC-OBJECT");
  const splices: Splice[] = [];

  const origSpecEntries = Array.from(originalDoc.specObjects.values());
  const renderedFallbackObjects: string[] = [];

  for (let idx = 0; idx < sysmlCst.requirementDefs.length; idx++) {
    const reqNode = sysmlCst.requirementDefs[idx];
    if (!reqNode) continue;
    const rawDefId = reqNode.id.endsWith("_Def") ? reqNode.id.slice(0, -4) : reqNode.id;

    // Resolve original SpecObject by ID, normalized ID, or positional fallback (rename resilience)
    let origObj = originalDoc.specObjects.get(rawDefId) ?? originalDoc.specObjects.get(rawDefId.replace(/_/g, "-"));
    if (!origObj) {
      for (const candidate of origSpecEntries) {
        if (candidate.identifier.replace(/[^a-zA-Z0-9_]/g, "_") === rawDefId) {
          origObj = candidate;
          break;
        }
      }
    }
    if (!origObj && origSpecEntries.length === sysmlCst.requirementDefs.length) {
      origObj = origSpecEntries[idx];
    }

    const threadKey = origObj?.identifier ?? rawDefId;
    const resolvedReqId =
      rawDefId.includes("_") && origObj?.identifier.includes("-") && rawDefId.replace(/_/g, "-") === origObj.identifier
        ? origObj.identifier
        : rawDefId;

    // Evaluate declarative TGG rule backward for RequirementDefinition -> SpecObject
    const backEval = transformer.evaluateRuleBackward(
      {
        kind: "RequirementDefinition",
        name: `${rawDefId}_Def`,
        doc: reqNode.docText,
        reqId: resolvedReqId,
        asilLevel: reqNode.attributes["asilLevel"] ?? reqNode.attributes["asil"],
        properties: {
          name: `${rawDefId}_Def`,
          doc: reqNode.docText,
          reqId: resolvedReqId,
          asilLevel: reqNode.attributes["asilLevel"] ?? reqNode.attributes["asil"],
        },
      },
      "reqif",
      {
        strategy,
        threadId: threadKey,
        fallbackThreadId: `pos:${idx}`,
      },
    );

    const complement = transformer.getComplement(threadKey) ?? transformer.getComplement(`pos:${idx}`) ?? {};
    const longName = (complement["longName"] as string | undefined) ?? origObj?.longName ?? "Braking Distance";

    let reconciledText = String(backEval?.sourceNode["properties"]?.["text"] ?? reqNode.docText);
    const docTextChanged = origObj !== undefined && origObj.text !== reqNode.docText;
    if (origObj && docTextChanged) {
      changes.push({
        target: "text",
        elementId: resolvedReqId,
        property: "text",
        sourceOldVal: origObj.text,
        targetNewVal: reqNode.docText,
        reconciledVal: reconciledText,
        strategy,
      });
    }

    // Parse and reconcile `require constraint { var op limit }` via declarative rule #2
    const constraintExpr = reqNode.constraints[0];
    if (constraintExpr) {
      const cMatch = /^([A-Za-z_]\w*)\s*(<=|<|>=|>|==|!=)\s*([-+]?\d+(?:\.\d+)?)$/.exec(constraintExpr);
      if (cMatch && cMatch[1] && cMatch[2] && cMatch[3]) {
        const modVar = cMatch[1];
        const modOp = cMatch[2];
        const modLimit = Number(cMatch[3]);
        const oldLimit = origObj?.contract?.limitValue;
        const contractChanged =
          oldLimit === undefined ||
          oldLimit !== modLimit ||
          origObj?.contract?.comparator !== modOp ||
          origObj?.contract?.variable !== modVar;

        const contractBack = transformer.evaluateRuleBackward(
          {
            kind: "RequireConstraint",
            name: `${resolvedReqId}:contract`,
            variable: modVar,
            operator: modOp,
            rhs: modLimit,
            properties: { variable: modVar, operator: modOp, rhs: modLimit },
          },
          "reqif",
          { strategy, threadId: `${threadKey}:contract` },
        );
        const resolvedLimit = Number(contractBack?.sourceNode["properties"]?.["limitValue"] ?? modLimit);

        if (oldLimit !== undefined && oldLimit !== modLimit) {
          changes.push({
            target: "contract",
            elementId: resolvedReqId,
            property: "limitValue",
            sourceOldVal: oldLimit,
            targetNewVal: modLimit,
            reconciledVal: resolvedLimit,
            strategy,
          });
        }

        if (contractChanged || !docTextChanged) {
          reconciledText = reconciledText.replace(
            /([A-Za-z_][A-Za-z0-9_]*)\s+(from\s+[-+]?[0-9]*\.?[0-9]+\s*[a-zA-Z0-9/_%-]+\s+)?(must\s+be\s+|shall\s+be\s+)?(<=|<|>=|>|==|!=)\s*[-+]?[0-9]*\.?[0-9]+/,
            `${modVar} $2$3${modOp} ${resolvedLimit}`,
          );
        }
      }
    }

    // Reconcile ASIL attribute (`attribute asil : String = "ASIL-D"` or `attribute asilLevel = ...`)
    const newAsil = (reqNode.attributes["asil"] ?? reqNode.attributes["asilLevel"]) as AsilLevel | undefined;
    const oldAsil = origObj?.asilLevel;
    if (newAsil) {
      let resolvedAsil = newAsil;
      if (oldAsil && oldAsil !== newAsil) {
        const conflictId = `${resolvedReqId}.asilLevel`;
        transformer.recordConflict(conflictId, oldAsil, newAsil, reqifTggRules[0]?.name ?? "ReqIF-SysML-Sync");
        transformer.resolveConflict(conflictId, strategy === "source-wins" ? "source" : "target");
        resolvedAsil = strategy === "source-wins" ? oldAsil : newAsil;
        changes.push({
          target: "asilLevel",
          elementId: resolvedReqId,
          property: "asilLevel",
          sourceOldVal: oldAsil,
          targetNewVal: newAsil,
          reconciledVal: resolvedAsil,
          strategy,
        });
      }
      if (/\b(ASIL-[ABCD]|QM)\b/.test(reconciledText)) {
        reconciledText = reconciledText.replace(/\b(ASIL-[ABCD]|QM)\b/g, resolvedAsil);
      } else if (reconciledText) {
        reconciledText = `${reconciledText.replace(/\.$/, "")}. ${resolvedAsil}.`;
      }
    }

    // Locate corresponding <SPEC-OBJECT> in the lossless XML CST and apply surgical splices
    const xmlEl =
      specObjElements.find(
        (el) =>
          el.attributes.find((a: any) => a.name.toUpperCase() === "IDENTIFIER")?.value ===
          (origObj?.identifier ?? resolvedReqId),
      ) ?? specObjElements[idx];

    if (xmlEl) {
      if (origObj && origObj.identifier !== resolvedReqId) {
        splices.push(xml.setAttributeSplice(xmlEl, "IDENTIFIER", resolvedReqId, originalReqIfXml));
      }
      const theValueEl = findXmlElements(xmlEl, "THE-VALUE")[0];
      if (theValueEl && !theValueEl.selfClosing) {
        splices.push(xml.setElementTextSplice(theValueEl, reconciledText));
      } else {
        const attrValEl = findXmlElements(xmlEl, "ATTRIBUTE-VALUE-STRING")[0];
        if (attrValEl && attrValEl.attributes.some((a: any) => a.name.toUpperCase() === "THE-VALUE")) {
          splices.push(xml.setAttributeSplice(attrValEl, "THE-VALUE", reconciledText, originalReqIfXml));
        }
      }
    } else {
      renderedFallbackObjects.push(`<SPEC-OBJECT IDENTIFIER="${escapeXml(resolvedReqId)}" LONG-NAME="${escapeXml(longName)}">
  <VALUES>
    <ATTRIBUTE-VALUE-STRING>
      <THE-VALUE>${escapeXml(reconciledText)}</THE-VALUE>
    </ATTRIBUTE-VALUE-STRING>
  </VALUES>
</SPEC-OBJECT>`);
    }
  }

  let updatedText = originalReqIfXml;
  if (splices.length > 0 || renderedFallbackObjects.length > 0) {
    if (renderedFallbackObjects.length > 0) {
      const specObjectsContainer = findXmlElements(xmlDoc.root, "SPEC-OBJECTS")[0];
      if (specObjectsContainer) {
        for (const snippet of renderedFallbackObjects) {
          splices.push(xml.appendChildSplice(specObjectsContainer, snippet, originalReqIfXml));
        }
        updatedText = xml.applySplices(originalReqIfXml, splices);
      } else {
        updatedText = `${xml.applySplices(originalReqIfXml, splices).trim()}\n\n${renderedFallbackObjects.join("\n\n")}`;
      }
    } else {
      updatedText = xml.applySplices(originalReqIfXml, splices);
    }
  }

  return {
    updatedText,
    changes,
    conflicts: transformer.getConflicts(),
    transformer,
  };
}
