// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseCfdConfig } from "@modelscript/cfd";
import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
import { parseFeaDeck } from "@modelscript/fea";
import { CodeLens, Range } from "vscode-languageserver";
import { type LspContext, resolveFeatureFlags } from "../lsp-context.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { CadMetricsService } from "../services/cad-metrics-service.js";
import { findCstNodesByType } from "../utils/ast-utils.js";

const defaultCadMetricsService = new CadMetricsService();

type SysmlDefKind = "part" | "requirement" | "verification" | "action" | "state";

const MODELICA_CLASS_KINDS = new Set(["model", "block", "study", "process", "class", "function", "record"]);
const SYSML_DEF_KEYWORD_MAP: Record<string, SysmlDefKind> = {
  part: "part",
  requirement: "requirement",
  verification: "verification",
  action: "action",
  calc: "action",
  state: "state",
  activity: "state",
};

function isWsCharCode(code: number): boolean {
  return code === 32 || code === 9 || code === 13 || code === 10 || code === 11 || code === 12;
}

function isIdentStartCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isIdentContCode(code: number): boolean {
  return isIdentStartCode(code) || (code >= 48 && code <= 57);
}

function skipWs(text: string, idx: number): number {
  let i = idx;
  while (i < text.length && isWsCharCode(text.charCodeAt(i))) i++;
  return i;
}

function splitLinesPreserve(text: string): string[] {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.endsWith("\r")) {
      lines[i] = line.slice(0, -1);
    }
  }
  return lines;
}

function splitWsTokens(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && isWsCharCode(text.charCodeAt(i))) i++;
    const start = i;
    while (i < text.length && !isWsCharCode(text.charCodeAt(i))) i++;
    if (i > start) tokens.push(text.slice(start, i));
  }
  return tokens;
}

function hasWordMatch(text: string, word: string): boolean {
  if (!word) return false;
  let pos = 0;
  while (pos <= text.length - word.length) {
    const idx = text.indexOf(word, pos);
    if (idx === -1) return false;
    const beforeOk = idx === 0 || !isIdentContCode(text.charCodeAt(idx - 1));
    const afterIdx = idx + word.length;
    const afterOk = afterIdx >= text.length || !isIdentContCode(text.charCodeAt(afterIdx));
    if (beforeOk && afterOk) return true;
    pos = idx + 1;
  }
  return false;
}

function containsCaseInsensitiveAny(text: string, needles: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

function humanizeActionId(actionId: string): string {
  const spaced = actionId.split("_").join(" ");
  let out = "";
  let prevWasWord = false;
  for (let i = 0; i < spaced.length; i++) {
    const ch = spaced[i]!;
    const isWord = isIdentContCode(ch.charCodeAt(0));
    out += !prevWasWord && isWord ? ch.toUpperCase() : ch;
    prevWasWord = isWord;
  }
  return out;
}

function stripLeadingKeywords(text: string, keywords: readonly string[]): string {
  let pos = 0;
  for (const kw of keywords) {
    if (!text.startsWith(kw, pos)) return text;
    pos += kw.length;
    const afterWs = skipWs(text, pos);
    if (afterWs === pos) return text;
    pos = afterWs;
  }
  return text.slice(pos);
}

function readAlnumIdent(text: string, idx: number): { token: string; next: number } | undefined {
  let i = idx;
  while (i < text.length && isIdentContCode(text.charCodeAt(i))) i++;
  return i > idx ? { token: text.slice(idx, i), next: i } : undefined;
}

function readStrictIdent(text: string, idx: number): { token: string; next: number } | undefined {
  if (idx >= text.length || !isIdentStartCode(text.charCodeAt(idx))) return undefined;
  return readAlnumIdent(text, idx + 1)
    ? { token: text.slice(idx, readAlnumIdent(text, idx + 1)!.next), next: readAlnumIdent(text, idx + 1)!.next }
    : { token: text[idx]!, next: idx + 1 };
}

function isNumericTokenChar(code: number): boolean {
  return (code >= 48 && code <= 57) || code === 46 || code === 101 || code === 69 || code === 43 || code === 45;
}

function extractFirstNumberAfterEquals(text: string): string | undefined {
  const eqIdx = text.indexOf("=");
  if (eqIdx === -1) return undefined;
  const start = skipWs(text, eqIdx + 1);
  let i = start;
  while (i < text.length && isNumericTokenChar(text.charCodeAt(i))) i++;
  return i > start ? text.slice(start, i) : undefined;
}

function extractQuotedAnnotationAttr(text: string, keys: readonly string[]): string | undefined {
  const lower = text.toLowerCase();
  for (const key of keys) {
    let pos = 0;
    while (pos <= lower.length - key.length) {
      const idx = lower.indexOf(key, pos);
      if (idx === -1) break;
      let i = skipWs(text, idx + key.length);
      if (text[i] === "=") {
        i = skipWs(text, i + 1);
        if (text[i] === '"') {
          const valStart = i + 1;
          const valEnd = text.indexOf('"', valStart);
          if (valEnd > valStart) {
            return text.slice(valStart, valEnd);
          }
        }
      }
      pos = idx + 1;
    }
  }
  return undefined;
}

function extractScadTagPortFromLine(line: string): { portName: string; portType: string } | undefined {
  let pos = 0;
  while (pos < line.length) {
    const idx = line.indexOf("tag_port", pos);
    if (idx === -1) return undefined;
    let i = skipWs(line, idx + 8);
    if (line[i] === "(") {
      i = skipWs(line, i + 1);
      if (line[i] === '"') {
        const nameStart = i + 1;
        const nameEnd = line.indexOf('"', nameStart);
        if (nameEnd > nameStart) {
          i = skipWs(line, nameEnd + 1);
          if (line[i] === ",") {
            i = skipWs(line, i + 1);
            if (line[i] === '"') {
              const typeStart = i + 1;
              const typeEnd = line.indexOf('"', typeStart);
              if (typeEnd > typeStart) {
                return {
                  portName: line.slice(nameStart, nameEnd),
                  portType: line.slice(typeStart, typeEnd),
                };
              }
            }
          }
        }
      }
    }
    pos = idx + 1;
  }
  return undefined;
}

function extractFeaSolidSectionMaterial(line: string): string | undefined {
  if (!line.slice(0, 14).toUpperCase().startsWith("*SOLID SECTION")) return undefined;
  const upper = line.toUpperCase();
  let pos = 14;
  while (pos <= upper.length - 8) {
    const idx = upper.indexOf("MATERIAL", pos);
    if (idx === -1) break;
    const beforeOk = idx === 0 || !isIdentContCode(upper.charCodeAt(idx - 1));
    if (beforeOk) {
      let i = skipWs(line, idx + 8);
      if (line[i] === "=") {
        const start = skipWs(line, i + 1);
        let end = start;
        while (end < line.length && line[end] !== "," && !isWsCharCode(line.charCodeAt(end))) {
          end++;
        }
        if (end > start) {
          return line.slice(start, end).split("_").join(" ");
        }
      }
    }
    pos = idx + 1;
  }
  return "Solid Section";
}

function countStepEntities(text: string): number {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    const hashIdx = text.indexOf("#", i);
    if (hashIdx === -1) break;
    let p = hashIdx + 1;
    const digitStart = p;
    while (p < text.length) {
      const code = text.charCodeAt(p);
      if (code < 48 || code > 57) break;
      p++;
    }
    if (p > digitStart) {
      const afterWs = skipWs(text, p);
      if (text[afterWs] === "=") {
        count++;
        i = afterWs + 1;
        continue;
      }
    }
    i = hashIdx + 1;
  }
  return count;
}

function matchModelicaClassDeclLine(line: string): { kind: string; name: string } | undefined {
  let pos = skipWs(line, 0);
  const kw = readAlnumIdent(line, pos);
  if (!kw || !MODELICA_CLASS_KINDS.has(kw.token)) return undefined;
  pos = skipWs(line, kw.next);
  if (pos === kw.next) return undefined;
  const name = readAlnumIdent(line, pos);
  return name ? { kind: kw.token, name: name.token } : undefined;
}

function isModelicaEndClassLine(line: string, className: string): boolean {
  let pos = skipWs(line, 0);
  if (!line.startsWith("end", pos)) return false;
  pos += 3;
  const nameStart = skipWs(line, pos);
  if (nameStart === pos) return false;
  if (!line.startsWith(className, nameStart)) return false;
  pos = skipWs(line, nameStart + className.length);
  return line[pos] === ";";
}

function matchModelicaForLoopLine(line: string): boolean {
  let pos = skipWs(line, 0);
  if (!line.startsWith("for", pos)) return false;
  pos += 3;
  const varStart = skipWs(line, pos);
  if (varStart === pos) return false;
  const loopVar = readStrictIdent(line, varStart);
  if (!loopVar) return false;
  const inStart = skipWs(line, loopVar.next);
  if (inStart === loopVar.next || !line.startsWith("in", inStart)) return false;
  const rangeStart = skipWs(line, inStart + 2);
  if (rangeStart === inStart + 2) return false;
  let rangeEnd = rangeStart;
  while (rangeEnd < line.length && !isWsCharCode(line.charCodeAt(rangeEnd))) rangeEnd++;
  if (rangeEnd === rangeStart) return false;
  const loopStart = skipWs(line, rangeEnd);
  if (loopStart === rangeEnd || !line.startsWith("loop", loopStart)) return false;
  const afterLoop = loopStart + 4;
  return afterLoop >= line.length || !isIdentContCode(line.charCodeAt(afterLoop));
}

function matchModelicaParamRealLine(line: string): { name: string; value: string } | undefined {
  let pos = skipWs(line, 0);
  if (!line.startsWith("parameter", pos)) return undefined;
  const realStart = skipWs(line, pos + 9);
  if (realStart === pos + 9 || !line.startsWith("Real", realStart)) return undefined;
  const nameStart = skipWs(line, realStart + 4);
  if (nameStart === realStart + 4) return undefined;
  const paramName = readAlnumIdent(line, nameStart);
  if (!paramName) return undefined;
  const eqIdx = skipWs(line, paramName.next);
  if (line[eqIdx] !== "=") return undefined;
  const valStart = skipWs(line, eqIdx + 1);
  let valEnd = valStart;
  while (valEnd < line.length && isNumericTokenChar(line.charCodeAt(valEnd))) valEnd++;
  return valEnd > valStart ? { name: paramName.token, value: line.slice(valStart, valEnd) } : undefined;
}

function matchSysmlDefLine(line: string): { kind: SysmlDefKind; name: string } | undefined {
  let pos = skipWs(line, 0);
  let word = readAlnumIdent(line, pos);
  if (!word) return undefined;
  if (word.token === "abstract") {
    pos = skipWs(line, word.next);
    if (pos === word.next) return undefined;
    word = readAlnumIdent(line, pos);
    if (!word) return undefined;
  }
  const kind = SYSML_DEF_KEYWORD_MAP[word.token];
  if (!kind) return undefined;
  const defStart = skipWs(line, word.next);
  if (defStart === word.next || !line.startsWith("def", defStart)) return undefined;
  const nameStart = skipWs(line, defStart + 3);
  if (nameStart === defStart + 3) return undefined;
  const name = readAlnumIdent(line, nameStart);
  return name ? { kind, name: name.token } : undefined;
}

function resolveDigitalTwinLens(
  context: LspContext,
  uri: string,
  param: string,
  val: string,
  twinTarget: string,
  range: Range,
): CodeLens {
  const numVal = parseFloat(val);
  const threadEntries = context.workspaceManager?.getThreadsForUri?.(uri) ?? [];
  let alignedPeers: any[] = [];
  if (threadEntries.length > 0 && context.workspaceManager?.findAlignedElementsBySlot) {
    alignedPeers = context.workspaceManager.findAlignedElementsBySlot(threadEntries[0]!.slot) ?? [];
  }

  // 1. Structural Mass Parity / Drift check against FEA & SysML
  if (param === "m" || param.toLowerCase() === "mass") {
    const feaPeer = alignedPeers.find(
      (p: any) =>
        p.domain?.toLowerCase() === "fea" &&
        (p.properties?.["mass"] !== undefined || p.meta?.properties?.["mass"] !== undefined),
    );
    const sysmlPeer = alignedPeers.find(
      (p: any) =>
        p.domain?.toLowerCase() === "sysml2" &&
        (p.properties?.["mass"] !== undefined || p.meta?.properties?.["mass"] !== undefined),
    );
    const expectedMass =
      feaPeer?.properties?.["mass"] ??
      feaPeer?.meta?.properties?.["mass"] ??
      sysmlPeer?.properties?.["mass"] ??
      sysmlPeer?.meta?.properties?.["mass"];

    if (expectedMass !== undefined && !Number.isNaN(numVal)) {
      const isParity = Math.abs(numVal - expectedMass) < 0.01;
      const feaName = feaPeer?.name ?? feaPeer?.meta?.name ?? "FEA";
      const rawSysmlName = sysmlPeer?.name ?? sysmlPeer?.meta?.name ?? "SysML";
      const sysmlName = stripLeadingKeywords(rawSysmlName, ["part", "def"]);
      const title = isParity
        ? `🔗 Digital Thread Parity: ${param} = ${numVal.toFixed(2)} kg [Aligned with FEA ${feaName} & SysML ${sysmlName}]`
        : `⚠ Digital Thread Drift: ${param} = ${val} kg (FEA Structural Mass: ${Number(expectedMass).toFixed(2)} kg) | Reconcile`;
      return {
        range,
        command: {
          title,
          command: "modelscript.syncDigitalThreadParams",
          arguments: [uri],
        },
      };
    }
  }

  // 2. Aerodynamic Drag Coefficient twin against CFD
  if (param === "Cd" || param.toLowerCase() === "aerodragcoeff") {
    const cfdPeer = alignedPeers.find((p: any) => p.domain?.toLowerCase() === "cfd");
    if (cfdPeer) {
      const cfdName = cfdPeer.name ?? cfdPeer.meta?.name ?? "CFD";
      return {
        range,
        command: {
          title: `🔗 Aerodynamic Twin: ${param} = ${val} [Aligned with CFD ${cfdName} RANS Polar]`,
          command: "modelscript.syncDigitalThreadParams",
          arguments: [uri],
        },
      };
    }
  }

  // 3. Frontal Area twin against CAD
  if (param === "A" || param.toLowerCase() === "frontalarea") {
    const cadPeer = alignedPeers.find((p: any) => p.domain?.toLowerCase() === "cad");
    if (cadPeer) {
      return {
        range,
        command: {
          title: `🔗 Frontal Area Twin: ${param} = ${val} m² [Aligned with OpenSCAD CAD Projection]`,
          command: "modelscript.syncDigitalThreadParams",
          arguments: [uri],
        },
      };
    }
  }

  // 4. Fallback: Generic Digital Twin link
  return {
    range,
    command: {
      title: `🔗 Digital Twin: ${param} = ${val} [Linked to ${twinTarget}]`,
      command: "modelscript.syncDigitalThreadParams",
      arguments: [uri],
    },
  };
}

export function registerCodeLensProvider(context: LspContext) {
  context.connection.onRequest("textDocument/codeLens", (params): CodeLens[] => {
    const uri = params.textDocument.uri;
    const lenses: CodeLens[] = [];

    const settings = context.settings;
    const features = resolveFeatureFlags(settings);
    const codeLensCfg = settings?.codeLens;
    if (codeLensCfg?.enabled === false) {
      return lenses;
    }

    const showSimulate = (codeLensCfg?.simulate ?? true) && features.codeLensSimulate;
    const showDiagram = codeLensCfg?.diagram ?? false;

    const rawVerif = codeLensCfg?.verification;
    const verificationMode: "all" | "problemsOnly" | "off" =
      rawVerif === "all" || rawVerif === true
        ? "all"
        : rawVerif === "off" || rawVerif === false
          ? "off"
          : "problemsOnly";
    const showVerification =
      verificationMode !== "off" && (features.formalVerification || rawVerif === true || rawVerif === "all");
    const showPolyglotLinks = (codeLensCfg?.polyglotLinks ?? features.digitalThread) && features.digitalThread;
    const showCadMetrics = codeLensCfg?.cadMetrics ?? false;
    const showFileConversions = (codeLensCfg?.fileConversions ?? false) && features.caeWorkbench;

    // 1. Modelica files (.mo)
    if (uri.endsWith(".mo")) {
      const doc = context.documents.get(uri);
      const text = doc?.getText();

      const proofMap = context.validationService?.modelicaProofResultsByUri?.get(uri);
      const daeMap = context.validationService?.modelicaDaeVerificationResultsByUri?.get(uri);
      const emittedProofClasses = new Set<string>();
      const emittedDaeClasses = new Set<string>();

      const shouldEmitModelicaProof = (
        proof: { definiteBugs?: unknown[]; potentialBugs?: unknown[] } | null | undefined,
      ): boolean => {
        if (!proof || verificationMode === "off") return false;
        const hasDefects = (proof.definiteBugs?.length ?? 0) > 0 || (proof.potentialBugs?.length ?? 0) > 0;
        if (
          verificationMode === "problemsOnly" &&
          !features.formalVerification &&
          rawVerif !== true &&
          rawVerif !== "all"
        ) {
          return hasDefects;
        }
        return true;
      };

      const shouldEmitDaeProof = (daeProof: { issues?: unknown[] } | null | undefined): boolean => {
        if (!daeProof || verificationMode === "off") return false;
        const hasIssues = (daeProof.issues?.length ?? 0) > 0;
        if (
          verificationMode === "problemsOnly" &&
          !features.formalVerification &&
          rawVerif !== true &&
          rawVerif !== "all"
        ) {
          return hasIssues;
        }
        return true;
      };

      let usedCst = false;
      const treeEntry =
        (context.documentManager as any)?.getDocumentTree?.(uri) ??
        (context.documentManager as any)?.documentTrees?.get?.(uri);
      const rootNode = treeEntry?.tree?.rootNode ?? treeEntry?.rootNode;

      if (rootNode) {
        const classNodes = findCstNodesByType(rootNode, "class_definition");
        if (classNodes.length > 0) {
          usedCst = true;
          for (const classNode of classNodes) {
            const idNode = findCstNodesByType(classNode, "identifier")[0];
            if (!idNode) continue;
            const name = idNode.text?.trim() || "";
            if (!name) continue;

            const lineIdx = idNode.startPosition?.row ?? 0;
            const col = idNode.startPosition?.column ?? 0;
            const range = Range.create(lineIdx, col, lineIdx, col + name.length);

            const prefixesNode = findCstNodesByType(classNode, "class_prefixes")[0];
            let rawKind = "class";
            if (prefixesNode?.text) {
              const words = splitWsTokens(prefixesNode.text);
              rawKind = words[words.length - 1] || "class";
            } else {
              const firstWord = splitWsTokens(classNode.text || "")[0];
              if (firstWord) rawKind = firstWord;
            }

            if (
              showSimulate &&
              (rawKind === "model" || rawKind === "block" || rawKind === "study" || rawKind === "process")
            ) {
              const hasThreadLinks =
                (showPolyglotLinks || showVerification) &&
                Boolean(context.workspaceManager?.getThreadsForUri?.(uri)?.length);
              if (showVerification && hasThreadLinks) {
                lenses.push({
                  range,
                  command: {
                    title: "▶ Estimate Reachability Envelope (linearized zonotope, non-rigorous)",
                    command: "modelscript.runReachabilityFlowpipe",
                    arguments: [uri],
                  },
                });
              }
              const title = hasThreadLinks
                ? "▶ Simulate Model (RK4 / CVODE DAE)"
                : rawKind === "study"
                  ? "▶ Run Study"
                  : `▶ Simulate ${rawKind}`;
              lenses.push({
                range,
                command: {
                  title,
                  command: rawKind === "study" ? "modelscript.openSimulationView" : "modelscript.action.simulate",
                  arguments: [uri, name],
                },
              });
              if (showPolyglotLinks && hasThreadLinks) {
                lenses.push({
                  range,
                  command: {
                    title: "🌐 Digital Thread Explorer",
                    command: "modelscript.openThreadExplorer",
                    arguments: [uri],
                  },
                });
              }
              if (showDiagram) {
                lenses.push({
                  range,
                  command: {
                    title: "⊞ Open Interactive Diagram",
                    command: "modelscript.openDiagram",
                    arguments: [uri],
                  },
                });
              }
            }

            // Formal proof badge for this model/class/function on this exact declaration line
            const proof = proofMap?.get(name);
            if (shouldEmitModelicaProof(proof)) {
              emittedProofClasses.add(name);
              let proofTitle = "✓ Formally Verified (0 RTEs, 100% Proven Safe)";
              if (proof.definiteBugs.length > 0) {
                proofTitle = `✗ Formal Defect: ${proof.definiteBugs.length} bug(s) detected`;
              } else if (proof.potentialBugs.length > 0) {
                const oobCount = proof.potentialBugs.filter((b: any) => b.category === "array_out_of_bounds").length;
                if (oobCount > 0) {
                  proofTitle = `⚠ Formal Proof: ${proof.potentialBugs.length} unproven condition(s) (array out of bounds)`;
                } else {
                  proofTitle = `⚠ Formal Proof: ${proof.potentialBugs.length} unproven condition(s)`;
                }
              }

              lenses.push({
                range,
                command: {
                  title: proofTitle,
                  command: "modelscript.showProofDetails",
                  arguments: [uri, name, proof.formattedMatrix],
                },
              });
            }

            // DAE BLT verification badge for this model/class on this exact declaration line
            const daeProof = daeMap?.get(name);
            if (shouldEmitDaeProof(daeProof)) {
              emittedDaeClasses.add(name);
              let daeTitle =
                daeProof.verdict?.kind === "proven"
                  ? "✓ DAE: no singularities (interval analysis, all variables bounded)"
                  : `◌ DAE: no singularity found among bounded variables (${daeProof.unboundedVariables ?? "some"} unbounded — not proven)`;
              if (daeProof.issues.length > 0) {
                const definite = daeProof.issues.find((i: any) => i.severity === "definite");
                if (definite) {
                  daeTitle = `✗ DAE Defect: ${definite.message}`;
                } else {
                  daeTitle = `⚠ DAE Invariant: ${daeProof.issues[0].message}`;
                }
              }

              lenses.push({
                range,
                command: {
                  title: daeTitle,
                  command: "modelscript.showDaeVerificationDetails",
                  arguments: [uri, name, daeProof],
                },
              });
            }

            // For loop formal verification lens (positioned above the loop)
            const forNodes = [
              ...findCstNodesByType(classNode, "for_statement"),
              ...findCstNodesByType(classNode, "for_equation"),
            ];
            for (const forNode of forNodes) {
              if (shouldEmitModelicaProof(proof)) {
                const forLine = forNode.startPosition?.row ?? 0;
                const forCol = forNode.startPosition?.column ?? 0;
                const loopRange = Range.create(forLine, forCol, forLine, forCol + 3);

                const loopBug =
                  proof.definiteBugs.find((b: any) => b.category === "array_out_of_bounds") ??
                  proof.potentialBugs.find((b: any) => b.category === "array_out_of_bounds") ??
                  proof.definiteBugs[0] ??
                  proof.potentialBugs[0];

                let loopTitle: string | undefined;
                if (loopBug) {
                  if (loopBug.category === "array_out_of_bounds") {
                    const w = loopBug.witnessValues;
                    const detail = w?.index && w?.arrayLength ? ` [${w.index} vs declared size ${w.arrayLength}]` : "";
                    loopTitle = `⚠ Formal Proof: Array index out of bounds${detail}`;
                  } else {
                    loopTitle = `⚠ Formal Proof: ${loopBug.description}`;
                  }
                } else if (verificationMode === "all") {
                  if (proof.isCertifiedSafe) {
                    loopTitle = "✓ Loop Formally Verified (Safe Bounds)";
                  } else {
                    loopTitle = "✓ Loop Invariants Verified";
                  }
                }

                if (loopTitle) {
                  lenses.push({
                    range: loopRange,
                    command: {
                      title: loopTitle,
                      command: "modelscript.showProofDetails",
                      arguments: [uri, name, proof.formattedMatrix],
                    },
                  });
                }
              }
            }

            // Twin / Digital Thread Parameter inspection
            if (showPolyglotLinks) {
              const compClauses = findCstNodesByType(classNode, "component_clause");
              for (const comp of compClauses) {
                const compText = comp.text || "";
                if (!hasWordMatch(compText, "parameter") || !hasWordMatch(compText, "Real")) continue;
                const compDecls = findCstNodesByType(comp, "component_declaration");
                for (const cd of compDecls) {
                  const compIdNode = findCstNodesByType(cd, "identifier")[0];
                  if (!compIdNode) continue;
                  const param = compIdNode.text?.trim();
                  if (!param) continue;

                  const modNode = findCstNodesByType(cd, "modification")[0];
                  const val =
                    (modNode?.text ? extractFirstNumberAfterEquals(modNode.text) : undefined) ??
                    extractFirstNumberAfterEquals(cd.text || "");
                  if (!val) continue;

                  const twinTarget = extractQuotedAnnotationAttr(cd.text || compText, ["twin", "counterpart"]);
                  if (!twinTarget) continue;

                  const paramLine = compIdNode.startPosition?.row ?? 0;
                  const paramCol = compIdNode.startPosition?.column ?? 0;
                  const pRange = Range.create(paramLine, paramCol, paramLine, paramCol + param.length);

                  lenses.push(resolveDigitalTwinLens(context, uri, param, val, twinTarget, pRange));
                }
              }
            }
          }
        }
      }

      if (!usedCst && text) {
        const lines = splitLinesPreserve(text);
        let currentClassName: string | undefined = undefined;

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx]!;

          // Model / Block / Study / Class / Function / Record declaration
          const classDecl = matchModelicaClassDeclLine(line);
          if (classDecl) {
            const { kind: rawKind, name } = classDecl;
            currentClassName = name;
            const col = line.indexOf(name);
            const range = Range.create(lineIdx, col, lineIdx, col + name.length);
            if (
              showSimulate &&
              (rawKind === "model" || rawKind === "block" || rawKind === "study" || rawKind === "process")
            ) {
              const hasThreadLinks =
                (showPolyglotLinks || showVerification) &&
                Boolean(context.workspaceManager?.getThreadsForUri?.(uri)?.length);
              if (showVerification && hasThreadLinks) {
                lenses.push({
                  range,
                  command: {
                    title: "▶ Estimate Reachability Envelope (linearized zonotope, non-rigorous)",
                    command: "modelscript.runReachabilityFlowpipe",
                    arguments: [uri],
                  },
                });
              }
              const title = hasThreadLinks
                ? "▶ Simulate Model (RK4 / CVODE DAE)"
                : rawKind === "study"
                  ? "▶ Run Study"
                  : `▶ Simulate ${rawKind}`;
              lenses.push({
                range,
                command: {
                  title,
                  command: rawKind === "study" ? "modelscript.openSimulationView" : "modelscript.action.simulate",
                  arguments: [uri, name],
                },
              });
              if (showPolyglotLinks && hasThreadLinks) {
                lenses.push({
                  range,
                  command: {
                    title: "🌐 Digital Thread Explorer",
                    command: "modelscript.openThreadExplorer",
                    arguments: [uri],
                  },
                });
              }
              if (showDiagram) {
                lenses.push({
                  range,
                  command: {
                    title: "⊞ Open Interactive Diagram",
                    command: "modelscript.openDiagram",
                    arguments: [uri],
                  },
                });
              }
            }

            // Formal proof badge for this model/class/function on this exact declaration line
            const proof = proofMap?.get(name);
            if (shouldEmitModelicaProof(proof)) {
              emittedProofClasses.add(name);
              let proofTitle = "✓ Formally Verified (0 RTEs, 100% Proven Safe)";
              if (proof.definiteBugs.length > 0) {
                proofTitle = `✗ Formal Defect: ${proof.definiteBugs.length} bug(s) detected`;
              } else if (proof.potentialBugs.length > 0) {
                const oobCount = proof.potentialBugs.filter((b: any) => b.category === "array_out_of_bounds").length;
                if (oobCount > 0) {
                  proofTitle = `⚠ Formal Proof: ${proof.potentialBugs.length} unproven condition(s) (array out of bounds)`;
                } else {
                  proofTitle = `⚠ Formal Proof: ${proof.potentialBugs.length} unproven condition(s)`;
                }
              }

              lenses.push({
                range,
                command: {
                  title: proofTitle,
                  command: "modelscript.showProofDetails",
                  arguments: [uri, name, proof.formattedMatrix],
                },
              });
            }

            // DAE BLT verification badge for this model/class on this exact declaration line
            const daeProof = daeMap?.get(name);
            if (shouldEmitDaeProof(daeProof)) {
              emittedDaeClasses.add(name);
              let daeTitle =
                daeProof.verdict?.kind === "proven"
                  ? "✓ DAE: no singularities (interval analysis, all variables bounded)"
                  : `◌ DAE: no singularity found among bounded variables (${daeProof.unboundedVariables ?? "some"} unbounded — not proven)`;
              if (daeProof.issues.length > 0) {
                const definite = daeProof.issues.find((i: any) => i.severity === "definite");
                if (definite) {
                  daeTitle = `✗ DAE Defect: ${definite.message}`;
                } else {
                  daeTitle = `⚠ DAE Invariant: ${daeProof.issues[0].message}`;
                }
              }

              lenses.push({
                range,
                command: {
                  title: daeTitle,
                  command: "modelscript.showDaeVerificationDetails",
                  arguments: [uri, name, daeProof],
                },
              });
            }
          }

          // Reset current class when leaving its definition
          if (currentClassName && isModelicaEndClassLine(line, currentClassName)) {
            currentClassName = undefined;
          }

          // For loop formal verification lens (positioned above the loop)
          if (matchModelicaForLoopLine(line) && currentClassName) {
            const proof = proofMap?.get(currentClassName);
            if (shouldEmitModelicaProof(proof)) {
              const col = line.indexOf("for");
              const loopRange = Range.create(lineIdx, col, lineIdx, col + 3);

              const loopBug =
                proof.definiteBugs.find((b: any) => b.category === "array_out_of_bounds") ??
                proof.potentialBugs.find((b: any) => b.category === "array_out_of_bounds") ??
                proof.definiteBugs[0] ??
                proof.potentialBugs[0];

              let loopTitle: string | undefined;
              if (loopBug) {
                if (loopBug.category === "array_out_of_bounds") {
                  const w = loopBug.witnessValues;
                  const detail = w?.index && w?.arrayLength ? ` [${w.index} vs declared size ${w.arrayLength}]` : "";
                  loopTitle = `⚠ Formal Proof: Array index out of bounds${detail}`;
                } else {
                  loopTitle = `⚠ Formal Proof: ${loopBug.description}`;
                }
              } else if (verificationMode === "all") {
                if (proof.isCertifiedSafe) {
                  loopTitle = "✓ Loop Formally Verified (Safe Bounds)";
                } else {
                  loopTitle = "✓ Loop Invariants Verified";
                }
              }

              if (loopTitle) {
                lenses.push({
                  range: loopRange,
                  command: {
                    title: loopTitle,
                    command: "modelscript.showProofDetails",
                    arguments: [uri, currentClassName, proof.formattedMatrix],
                  },
                });
              }
            }
          }

          // Twin / Digital Thread Parameter inspection (only when parameter has an explicit twin/counterpart annotation)
          const paramDecl = matchModelicaParamRealLine(line);
          if (showPolyglotLinks && paramDecl) {
            const { name: param, value: val } = paramDecl;
            const col = line.indexOf(param);
            const range = Range.create(lineIdx, col, lineIdx, col + param.length);

            // Check for twin annotation
            let scanWindow = line;
            for (let j = 1; j <= 3 && lineIdx + j < lines.length; j++) {
              if (scanWindow.includes(";")) break;
              scanWindow += " " + lines[lineIdx + j]!;
            }
            const twinTarget = extractQuotedAnnotationAttr(scanWindow, ["twin", "counterpart"]);

            if (twinTarget) {
              lenses.push(resolveDigitalTwinLens(context, uri, param, val, twinTarget, range));
            }
          }
        }
      }

      // Fallback: check formal proof results & DAE BLT results from symbol index for any un-emitted classes
      const index = (
        typeof context.workspaceManager?.getWorkspaceIndex === "function"
          ? context.workspaceManager.getWorkspaceIndex("modelica")
          : context.workspaceManager?.globalWorkspaceIndex
      )?.getFileIndex(uri);

      if (index) {
        const norm = (u: string | undefined) => (u ? u.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///").toLowerCase() : "");
        const targetUri = norm(uri);

        for (const [, symbol] of index.symbols.entries()) {
          const sym = symbol as any;
          // Guard: never process symbols belonging to other files in the workspace
          if (sym.resourceId && norm(sym.resourceId) !== targetUri) continue;
          if (
            sym.kind !== "Class" &&
            sym.kind !== "Def" &&
            sym.kind !== "Function" &&
            sym.classKind !== "function" &&
            sym.classKind !== "model" &&
            sym.classKind !== "block" &&
            sym.classKind !== "class"
          ) {
            continue;
          }

          let startLine = sym.selectionRange?.start.line ?? sym.range?.start?.line;
          let startChar = sym.selectionRange?.start.character ?? sym.range?.start?.character;
          if (startLine === undefined && doc && sym.startOffset !== undefined) {
            const pos = doc.positionAt(sym.startOffset);
            startLine = pos.line;
            startChar = pos.character;
          }
          startLine = startLine ?? 0;
          startChar = startChar ?? 0;
          const range = Range.create(startLine, startChar, startLine, startChar);

          const proof = proofMap?.get(sym.name);
          if (shouldEmitModelicaProof(proof) && !emittedProofClasses.has(sym.name)) {
            emittedProofClasses.add(sym.name);
            let proofTitle = "✓ Formally Verified (0 RTEs, 100% Proven Safe)";
            if (proof.definiteBugs.length > 0) {
              proofTitle = `✗ Formal Defect: ${proof.definiteBugs.length} bug(s) detected`;
            } else if (proof.potentialBugs.length > 0) {
              const oobCount = proof.potentialBugs.filter((b: any) => b.category === "array_out_of_bounds").length;
              if (oobCount > 0) {
                proofTitle = `⚠ Formal Proof: ${proof.potentialBugs.length} unproven condition(s) (array out of bounds)`;
              } else {
                proofTitle = `⚠ Formal Proof: ${proof.potentialBugs.length} unproven condition(s)`;
              }
            }

            lenses.push({
              range,
              command: {
                title: proofTitle,
                command: "modelscript.showProofDetails",
                arguments: [uri, sym.name, proof.formattedMatrix],
              },
            });
          }

          const daeProof = daeMap?.get(sym.name);
          if (shouldEmitDaeProof(daeProof) && !emittedDaeClasses.has(sym.name)) {
            emittedDaeClasses.add(sym.name);
            // Never display "verified" for anything other than a proven verdict.
            let daeTitle =
              daeProof.verdict?.kind === "proven"
                ? "✓ DAE: no singularities (interval analysis, all variables bounded)"
                : `◌ DAE: no singularity found among bounded variables (${daeProof.unboundedVariables ?? "some"} unbounded — not proven)`;
            if (daeProof.issues.length > 0) {
              const definite = daeProof.issues.find((i: any) => i.severity === "definite");
              if (definite) {
                daeTitle = `✗ DAE Defect: ${definite.message}`;
              } else {
                daeTitle = `⚠ DAE Invariant: ${daeProof.issues[0].message}`;
              }
            }

            lenses.push({
              range,
              command: {
                title: daeTitle,
                command: "modelscript.showDaeVerificationDetails",
                arguments: [uri, sym.name, daeProof],
              },
            });
          }
        }
      }
      return lenses;
    }

    // 2. SysML v2 files (.sysml, .kerml)
    if (uri.endsWith(".sysml") || uri.endsWith(".kerml")) {
      const document = context.documents.get(uri);
      const text = document?.getText();

      if (text) {
        const emitSysmlDefLenses = (kind: SysmlDefKind, name: string, range: Range) => {
          if (kind === "part") {
            const threadEntries =
              showPolyglotLinks && context.workspaceManager?.getThreadsForUri
                ? context.workspaceManager.getThreadsForUri(uri)
                : [];
            const matchingThread =
              threadEntries.find((e: any) => e.meta?.name?.includes(name)) ??
              (threadEntries.length === 1 ? threadEntries[0] : undefined);

            if (matchingThread && showPolyglotLinks && context.workspaceManager?.findAlignedElementsBySlot) {
              const aligned = context.workspaceManager.findAlignedElementsBySlot(matchingThread.slot);
              const engAligned = aligned.filter((el: any) => el.domain.toLowerCase() !== "requirements");
              const domainCount = engAligned.length > 0 ? engAligned.length : aligned.length;
              const labelMap: Record<string, string> = {
                sysml2: "SYSML",
                modelica: "MO",
                cad: "CAD",
                fea: "FEA",
                cfd: "CFD",
              };
              const activeDomainList = (engAligned.length > 0 ? engAligned : aligned).map(
                (el: any) => labelMap[el.domain.toLowerCase()] ?? el.domain.toUpperCase(),
              );
              const title = `⚡ Digital Thread: ${domainCount} Domains Linked (${activeDomainList.join(" + ")})`;
              lenses.push({
                range,
                command: {
                  title,
                  command: "modelscript.openThreadExplorer",
                  arguments: [uri, name],
                },
              });
              lenses.push({
                range,
                command: {
                  title: "$(sync) Sync Digital Thread Parameters",
                  command: "modelscript.syncDigitalThreadParams",
                  arguments: [uri],
                },
              });
              if (showVerification) {
                lenses.push({
                  range,
                  command: {
                    title: "🛡️ Verify Contracts & Hierarchy",
                    command: "modelscript.openContractExplorer",
                    arguments: [uri, name],
                  },
                });
              }
            } else {
              if (showVerification) {
                lenses.push({
                  range,
                  command: {
                    title: "🛡️ Verify Contracts & Hierarchy",
                    command: "modelscript.openContractExplorer",
                    arguments: [uri, name],
                  },
                });
              }
              if (features.scaffolding) {
                lenses.push({
                  range,
                  command: {
                    title: "⚡ Scaffold Multi-Domain (SCAD + MO + FEA)",
                    command: "modelscript.scaffoldMultiDomain",
                    arguments: [uri, name],
                  },
                });
              }
              if (features.demos) {
                lenses.push({
                  range,
                  command: {
                    title: "⚡ Tier 1: Validated | 📈 Tier 2: Pareto Candidates | 🚀 Schedule Tier 3 Confirmation",
                    command: "modelscript.openCandidateTradeStudy",
                    arguments: [uri, name],
                  },
                });
              }
            }
            if (showDiagram) {
              lenses.push({
                range,
                command: {
                  title: "⊞ Open Interactive Diagram",
                  command: "modelscript.openDiagram",
                  arguments: [uri],
                },
              });
            }
            return;
          }

          if (!showVerification) return;

          if (kind === "requirement") {
            lenses.push({
              range,
              command: {
                title: "▶ Estimate Requirement Reachability (linearized zonotope, non-rigorous)",
                command: "modelscript.runReachabilityFlowpipe",
                arguments: [uri],
              },
            });
            lenses.push({
              range,
              command: {
                title: "▶ Verify Flowpipes (CORA / WASM Zonotopes)",
                command: "modelscript.runReachabilityFlowpipe",
                arguments: [uri],
              },
            });
            lenses.push({
              range,
              command: {
                title: `🛡️ Verify Formal Requirement Contract: ${name}`,
                command: "modelscript.runReachabilityFlowpipe",
                arguments: [uri],
              },
            });
          } else if (kind === "verification") {
            lenses.push({
              range,
              command: {
                title: "▶ Run Continuous Reachability Verification (Nelson-Oppen / Salsa)",
                command: "modelscript.runReachabilityFlowpipe",
                arguments: [uri],
              },
            });
          } else if (kind === "action") {
            lenses.push({
              range,
              command: {
                title: "▶ Run Formal MC/DC Tests",
                command: "modelscript.runMcdcTests",
                arguments: [uri, name],
              },
            });
            lenses.push({
              range,
              command: {
                title: "📊 Decompose Regions",
                command: "modelscript.decomposeRegions",
                arguments: [uri, name],
              },
            });
          } else if (kind === "state") {
            lenses.push({
              range,
              command: {
                title: "⏱️ Replay Trace / Counterexample",
                command: "modelscript.openTraceReplay",
                arguments: [uri, name],
              },
            });
          }
        };

        let usedSysmlCst = false;
        type TreeEntryAccess = {
          getDocumentTree?(uri: string):
            | {
                tree?: { rootNode?: import("../utils/ast-utils.js").CstNodeLike };
                rootNode?: import("../utils/ast-utils.js").CstNodeLike;
              }
            | undefined;
          documentTrees?: Map<
            string,
            {
              tree?: { rootNode?: import("../utils/ast-utils.js").CstNodeLike };
              rootNode?: import("../utils/ast-utils.js").CstNodeLike;
            }
          >;
        };
        const docMgr = context.documentManager as unknown as TreeEntryAccess | undefined;
        const sysmlTreeEntry = docMgr?.getDocumentTree?.(uri) ?? docMgr?.documentTrees?.get?.(uri);
        const sysmlRootNode = sysmlTreeEntry?.tree?.rootNode ?? sysmlTreeEntry?.rootNode;
        if (sysmlRootNode) {
          const cstTypeToKind: Record<string, SysmlDefKind> = {
            partdefinition: "part",
            requirementdefinition: "requirement",
            verificationcasedefinition: "verification",
            actiondefinition: "action",
            calculationdefinition: "action",
            statedefinition: "state",
          };
          const visitSysml = (node: import("../utils/ast-utils.js").CstNodeLike | null | undefined) => {
            if (!node) return;
            const normType = (node.type || "").toLowerCase();
            const kind = cstTypeToKind[normType];
            if (kind) {
              const nameNode =
                node.childForFieldName?.("declaredName") ?? node.children?.find((c) => c.type === "Name");
              const name = nameNode?.text?.trim();
              if (name) {
                usedSysmlCst = true;
                const lineIdx = nameNode?.startPosition?.row ?? node.startPosition?.row ?? 0;
                const col = nameNode?.startPosition?.column ?? node.startPosition?.column ?? 0;
                emitSysmlDefLenses(kind, name, Range.create(lineIdx, col, lineIdx, col + name.length));
              }
            }
            if (node.children) {
              for (const child of node.children) {
                visitSysml(child);
              }
            }
          };
          visitSysml(sysmlRootNode);
        }

        if (!usedSysmlCst) {
          const lines = splitLinesPreserve(text);
          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx]!;
            const parsed = matchSysmlDefLine(line);
            if (parsed) {
              const col = line.indexOf(parsed.name);
              const range = Range.create(lineIdx, col, lineIdx, col + parsed.name.length);
              emitSysmlDefLenses(parsed.kind, parsed.name, range);
            }
          }
        }
      }
      return lenses;
    }

    // 3. OpenSCAD files (.scad)
    if (uri.endsWith(".scad")) {
      const document = context.documents.get(uri);
      const text = document?.getText();
      if (text) {
        const headerRange = Range.create(0, 0, 0, 0);
        if (showCadMetrics) {
          const threadEntries = context.workspaceManager?.getThreadsForUri?.(uri) ?? [];
          const threadMeta = threadEntries.find((e: any) => e.domain === "cad")?.meta ?? threadEntries[0]?.meta;
          const frontalArea = threadMeta?.properties?.["frontalArea"];
          const mass = threadMeta?.properties?.["mass"];
          const threadFallback =
            frontalArea !== undefined && mass !== undefined
              ? { frontalArea: Number(frontalArea), mass: Number(mass) }
              : undefined;

          const treeEntry = (context as any).documentManager?.documentTrees?.get(uri);
          const rootNode = treeEntry?.tree?.rootNode;

          const cadService = context.cadMetricsService ?? defaultCadMetricsService;
          const metricsTitle = cadService.getOrSchedule(uri, text, rootNode, context.connection, threadFallback);
          if (metricsTitle) {
            lenses.push({
              range: headerRange,
              command: {
                title: metricsTitle,
                command: "modelscript.openThreadExplorer",
                arguments: [uri],
              },
            });
          }
          lenses.push({
            range: headerRange,
            command: {
              title: "🎯 Open Interactive 3D CAD Editor (Gizmo Manipulation)",
              command: "modelscript.openCadViewer",
              arguments: [uri],
            },
          });
          if (showDiagram) {
            lenses.push({
              range: headerRange,
              command: {
                title: "⊞ Open Interactive Diagram",
                command: "modelscript.openDiagram",
                arguments: [uri],
              },
            });
          }
        }
        if (showFileConversions) {
          lenses.push({
            range: headerRange,
            command: {
              title: "⚡ Compile to STEP CAD (.step)",
              command: "modelscript.scad.export_step",
              arguments: [uri],
            },
          });
          lenses.push({
            range: headerRange,
            command: {
              title: "🕸️ Discretize CAD to FEA Mesh (.inp)",
              command: "modelscript.generateFeaMesh",
              arguments: [uri],
            },
          });
          lenses.push({
            range: headerRange,
            command: {
              title: "🌪️ Discretize CAD to CFD Mesh (.su2)",
              command: "modelscript.generateCfdMesh",
              arguments: [uri],
            },
          });
        }

        if (showPolyglotLinks) {
          const emitTagPortLens = (lineIdx: number, lineText: string, portName: string, portType: string) => {
            const col = Math.max(0, lineText.indexOf(portName));
            const range = Range.create(lineIdx, col, lineIdx, col + portName.length);
            lenses.push({
              range,
              command: {
                title: `🔗 Boundary Coupling Port: [${portName} (${portType})] -> Boundary Condition`,
                command: "modelscript.openPolyglotVisualizer",
                arguments: [uri, portName],
              },
            });
          };

          const scadTree =
            (context as any).documentManager?.getDocumentTree?.(uri) ??
            (context as any).documentManager?.documentTrees?.get?.(uri);
          const scadRootNode = scadTree?.tree?.rootNode ?? scadTree?.rootNode;
          const tagNodes = scadRootNode ? findCstNodesByType(scadRootNode, "TagPortOp") : [];
          const lines = splitLinesPreserve(text);

          if (tagNodes.length > 0) {
            for (const tagNode of tagNodes) {
              const parsed = extractScadTagPortFromLine(tagNode.text || "");
              if (!parsed) continue;
              const lineIdx = tagNode.startPosition?.row ?? 0;
              emitTagPortLens(lineIdx, lines[lineIdx] ?? "", parsed.portName, parsed.portType);
            }
          } else {
            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
              const line = lines[lineIdx]!;
              const parsed = extractScadTagPortFromLine(line);
              if (parsed) {
                emitTagPortLens(lineIdx, line, parsed.portName, parsed.portType);
              }
            }
          }
        }
      }
      return lenses;
    }

    const currentDoc = context.documents.get(uri);
    const currentText = currentDoc?.getText() ?? "";
    const detectedPlugin = globalLanguageRegistry.getPluginForUri(uri, currentText);

    // 4. FEA files (.inp, .inpt, .bdf, .fea)
    if (/\.(inp|inpt|bdf|fea)($|\?|#)/i.test(uri) && (!detectedPlugin || detectedPlugin.id === "fea")) {
      const text = currentText;
      if (text) {
        const headerRange = Range.create(0, 0, 0, 0);
        const threadEntries =
          showVerification || showPolyglotLinks || showCadMetrics
            ? (context.workspaceManager?.getThreadsForUri?.(uri) ?? [])
            : [];
        const feaThread = threadEntries.find((e: any) => e.domain === "fea") ?? threadEntries[0];
        const feaProps = feaThread?.meta?.properties;

        if (feaProps) {
          const maxStress = feaProps["maxStress"];
          const yieldStrength = feaProps["yieldStrength"];
          const mass = feaProps["mass"];
          if (showVerification && maxStress !== undefined && yieldStrength !== undefined) {
            const numMaxStress = Number(maxStress);
            const numYieldStrength = Number(yieldStrength);
            const sf = numYieldStrength / numMaxStress;
            lenses.push({
              range: headerRange,
              command: {
                title: `🔬 FEA Structural Invariant: σ_max = ${numMaxStress.toFixed(1)} MPa ≤ ${numYieldStrength.toFixed(1)} MPa (Safety Factor: ${sf.toFixed(2)})`,
                command: "modelscript.openThreadExplorer",
                arguments: [uri],
              },
            });
          }
          if (showPolyglotLinks && mass !== undefined) {
            lenses.push({
              range: headerRange,
              command: {
                title: `⚖️ Calibrated Mass: m = ${Number(mass).toFixed(2)} kg (Transferred to Modelica & SysML)`,
                command: "modelscript.syncDigitalThreadParams",
                arguments: [uri],
              },
            });
          }
        }

        let nodeCount = 0;
        let elemCount = 0;
        if (showCadMetrics) {
          const feaPath = uri.split(/[?#]/, 1)[0]!.toLowerCase();
          const feaData = parseFeaDeck(text, feaPath.endsWith(".bdf") ? "bdf" : "inp");
          nodeCount = feaData.nodes.size;
          elemCount = feaData.elements.size;

          const lines = splitLinesPreserve(text);
          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx]!;
            const matLabel = extractFeaSolidSectionMaterial(line);
            if (matLabel !== undefined) {
              const range = Range.create(lineIdx, 0, lineIdx, line.length);
              lenses.push({
                range,
                command: {
                  title: `📐 Composite Section Envelope: ${matLabel}`,
                  command: "modelscript.openStepViewer",
                  arguments: [uri],
                },
              });
            }
          }
        }

        if (showCadMetrics) {
          const meshSummary = nodeCount > 0 || elemCount > 0 ? ` (${nodeCount} Nodes, ${elemCount} Elements)` : "";
          lenses.push({
            range: headerRange,
            command: {
              title: `🕸️ Open 3D CAE Mesh Viewer${meshSummary}`,
              command: "modelscript.openStepViewer",
              arguments: [uri],
            },
          });
        }
        if (showDiagram) {
          lenses.push({
            range: headerRange,
            command: {
              title: "⊞ Open Interactive Diagram",
              command: "modelscript.openDiagram",
              arguments: [uri],
            },
          });
        }
      }
      return lenses;
    }

    // 5. CFD files (.cfg, .cfgt, .su2, .cfd)
    if (/\.(cfg|cfgt|su2|cfd|foam)($|\?|#)/i.test(uri) && (!detectedPlugin || detectedPlugin.id === "cfd")) {
      const text = currentText;
      if (text) {
        const headerRange = Range.create(0, 0, 0, 0);
        const threadEntries =
          showCadMetrics || showPolyglotLinks ? (context.workspaceManager?.getThreadsForUri?.(uri) ?? []) : [];
        const cfdThread = threadEntries.find((e: any) => e.domain === "cfd") ?? threadEntries[0];
        const cfdProps = cfdThread?.meta?.properties;

        const aeroDragCoeff = cfdProps?.["aeroDragCoeff"];
        const frontalArea = cfdProps?.["frontalArea"];

        if (aeroDragCoeff !== undefined && frontalArea !== undefined) {
          if (showCadMetrics) {
            lenses.push({
              range: headerRange,
              command: {
                title: `🌪️ CFD Aerodynamics: Cd = ${Number(aeroDragCoeff).toFixed(2)}, A_ref = ${Number(frontalArea).toFixed(3)} m² | Cruise Airspeed = 10.0 m/s`,
                command: "modelscript.openThreadExplorer",
                arguments: [uri],
              },
            });
          }
          if (showPolyglotLinks) {
            let moName = "Modelica";
            if (cfdThread && context.workspaceManager?.findAlignedElementsBySlot) {
              const aligned = context.workspaceManager.findAlignedElementsBySlot(cfdThread.slot) ?? [];
              const moPeer = aligned.find((p: any) => p.domain?.toLowerCase() === "modelica");
              const peerName = moPeer?.name;
              if (peerName) {
                moName = stripLeadingKeywords(peerName, ["model"]);
              }
            }
            lenses.push({
              range: headerRange,
              command: {
                title: `🔗 Transfer Aerodynamic Drag to Modelica ${moName}.Cd`,
                command: "modelscript.syncDigitalThreadParams",
                arguments: [uri],
              },
            });
          }
        } else if (showCadMetrics) {
          const cfdDialect = uri.split(/[?#]/, 1)[0]!.toLowerCase().endsWith(".foam") ? "openfoam" : "su2";
          const cfdData = parseCfdConfig(text, cfdDialect);
          const solver = cfdData.rawDirectives.get("SOLVER") || cfdData.directives.get("SOLVER") || "CFD";
          const rawRefArea = cfdData.rawDirectives.get("REF_AREA") || cfdData.directives.get("REF_AREA");
          const refArea = rawRefArea?.trim() || undefined;
          lenses.push({
            range: headerRange,
            command: {
              title: `🌪️ CFD Configuration: ${solver}${refArea ? ` | A_ref = ${refArea} m²` : ""}`,
              command: "modelscript.openThreadExplorer",
              arguments: [uri],
            },
          });
        }
        if (showDiagram) {
          lenses.push({
            range: headerRange,
            command: {
              title: "⊞ Open Interactive Diagram",
              command: "modelscript.openDiagram",
              arguments: [uri],
            },
          });
        }

        if (showPolyglotLinks && frontalArea !== undefined) {
          const cfdDialect = uri.split(/[?#]/, 1)[0]!.toLowerCase().endsWith(".foam") ? "openfoam" : "su2";
          const cfdData = parseCfdConfig(text, cfdDialect);
          const refAreaLine = cfdData.directiveLines?.get("REF_AREA");
          if (refAreaLine !== undefined && refAreaLine >= 1) {
            const lineIdx = refAreaLine - 1;
            const lines = splitLinesPreserve(text);
            const line = lines[lineIdx] ?? "";
            const range = Range.create(lineIdx, 0, lineIdx, line.length);
            lenses.push({
              range,
              command: {
                title: `📐 Parity Check: Ref Area matches OpenSCAD Frontal Area (${Number(frontalArea).toFixed(3)} m²)`,
                command: "modelscript.openThreadExplorer",
                arguments: [uri],
              },
            });
          }
        }
      }
      return lenses;
    }

    // 6. STEP CAD files (.step, .stp)
    if (/\.(step|stp|p21)($|\?|#)/i.test(uri)) {
      const headerRange = Range.create(0, 0, 0, 0);
      const text = currentText;
      if (showCadMetrics) {
        const entityCount = countStepEntities(text);
        const threadEntries = context.workspaceManager?.getThreadsForUri?.(uri) ?? [];
        const threadProps = threadEntries[0]?.meta?.properties;
        const nodes = threadProps?.["nodes"];
        const elements = threadProps?.["elements"];
        let stepTitle: string;
        if (nodes !== undefined && elements !== undefined) {
          stepTitle = `📐 3D B-Rep Solid Geometry: ${Number(nodes).toLocaleString()} Nodes, ${Number(elements).toLocaleString()} Elements`;
        } else {
          stepTitle = `📐 3D B-Rep Solid Geometry (${entityCount} STEP Entities)`;
        }
        lenses.push({
          range: headerRange,
          command: {
            title: stepTitle,
            command: "modelscript.openStepViewer",
            arguments: [uri],
          },
        });
      }
      if (showDiagram) {
        lenses.push({
          range: headerRange,
          command: {
            title: "⊞ Open Interactive Diagram",
            command: "modelscript.openDiagram",
            arguments: [uri],
          },
        });
      }
      if (showFileConversions) {
        lenses.push({
          range: headerRange,
          command: {
            title: "🕸️ Discretize CAD to FEA Mesh (.inp)",
            command: "modelscript.generateFeaMesh",
            arguments: [uri],
          },
        });
        lenses.push({
          range: headerRange,
          command: {
            title: "🌪️ Discretize CAD to CFD Mesh (.su2)",
            command: "modelscript.generateCfdMesh",
            arguments: [uri],
          },
        });
      }
      return lenses;
    }

    // 7. OLGA files (.opi, .olga, .genkey)
    if (/\.(opi|olga|genkey)($|\?|#)/i.test(uri) || detectedPlugin?.id === "olga") {
      const text = currentText;
      if (text) {
        const headerRange = Range.create(0, 0, 0, 0);
        if (showSimulate) {
          lenses.push({
            range: headerRange,
            command: {
              title: "▶ Simulate Multiphase Flow (Drift-Flux DAE)",
              command: "modelscript.olga.simulate_drift_flux",
              arguments: [uri],
            },
          });
        }
        if (showVerification) {
          lenses.push({
            range: headerRange,
            command: {
              title: "✓ Verify Flow Assurance (WAT, Hydrates, Slugging)",
              command: "modelscript.olga.verify_flow_assurance",
              arguments: [uri],
            },
          });
        }
        if (showDiagram) {
          lenses.push({
            range: headerRange,
            command: {
              title: "⊞ Open Interactive Diagram",
              command: "modelscript.openDiagram",
              arguments: [uri],
            },
          });
        }

        const xmlDoc = parseXmlSync(text);
        if (xmlDoc.root) {
          const lineOffsets = computeLineOffsets(text);
          const walkOlga = (el: XmlElement): void => {
            const tag = (el.name.includes(":") ? el.name.slice(el.name.indexOf(":") + 1) : el.name).toLowerCase();
            if (tag === "flowpath" && showVerification) {
              const name = getXmlAttr(el, "name", "id");
              if (name) {
                const pos = offsetToPosition(el.start, lineOffsets);
                const col = text.indexOf(name, el.start);
                const namePos = col !== -1 && col < el.end ? offsetToPosition(col, lineOffsets) : pos;
                lenses.push({
                  range: Range.create(namePos.line, namePos.character, namePos.line, namePos.character + name.length),
                  command: {
                    title: `🌊 Flowpath '${name}' | Verify Multiphase Limits (WAT, Hydrates, Slug Surge)`,
                    command: "modelscript.olga.verify_flow_assurance",
                    arguments: [uri, name],
                  },
                });
              }
            } else if (tag === "valve" && showSimulate) {
              const name = getXmlAttr(el, "name", "id");
              if (name) {
                const openVal = getXmlAttr(el, "opening");
                const opening = openVal ? `${(parseFloat(openVal) * 100).toFixed(0)}%` : "100%";
                const pos = offsetToPosition(el.start, lineOffsets);
                const col = text.indexOf(name, el.start);
                const namePos = col !== -1 && col < el.end ? offsetToPosition(col, lineOffsets) : pos;
                lenses.push({
                  range: Range.create(namePos.line, namePos.character, namePos.line, namePos.character + name.length),
                  command: {
                    title: `🎛️ Choke '${name}' (Opening: ${opening}) | What-If Perturbation Sweep`,
                    command: "modelscript.olga.whatIfChoke",
                    arguments: [uri, name],
                  },
                });
              }
            } else if (tag === "pipe" && showSimulate) {
              const name = getXmlAttr(el, "label", "name");
              if (name) {
                const lenVal = getXmlAttr(el, "length");
                const diamVal = getXmlAttr(el, "diameter");
                const len = lenVal ? `${lenVal}m` : "";
                const diam = diamVal ? `Ø${diamVal}m` : "";
                const pos = offsetToPosition(el.start, lineOffsets);
                const col = text.indexOf(name, el.start);
                const namePos = col !== -1 && col < el.end ? offsetToPosition(col, lineOffsets) : pos;
                lenses.push({
                  range: Range.create(namePos.line, namePos.character, namePos.line, namePos.character + name.length),
                  command: {
                    title: `📏 Pipe '${name}' [${len} ${diam}] | Inspect Pressure & Holdup Profile`,
                    command: "modelscript.olga.inspect_olga_elevation_profile",
                    arguments: [uri, name],
                  },
                });
              }
            }
            for (const child of el.children) {
              walkOlga(child);
            }
          };
          walkOlga(xmlDoc.root);
        }
      }
      return lenses;
    }

    // 8. Universal Language Plugin CodeLens Provider (covers all remaining languages in the registry)
    if (detectedPlugin) {
      let targetLine = 0;
      if (currentText) {
        const lines = splitLinesPreserve(currentText);
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i]!.trim();
          if (
            t &&
            !t.startsWith("//") &&
            !t.startsWith("#") &&
            !t.startsWith(";") &&
            !t.startsWith("!") &&
            !t.startsWith("/*") &&
            !t.startsWith("<?xml")
          ) {
            targetLine = i;
            break;
          }
        }
      }
      const headerRange = Range.create(targetLine, 0, targetLine, 0);

      if (showDiagram) {
        lenses.push({
          range: headerRange,
          command: {
            title: `⊞ Open Interactive ${detectedPlugin.name} Diagram`,
            command: "modelscript.openDiagram",
            arguments: [uri],
          },
        });
      }

      if (detectedPlugin.id === "psse" && showSimulate) {
        lenses.push({
          range: headerRange,
          command: {
            title: "⊞ Open PSS/E Grid Workbench & Tables",
            command: "modelscript.openRawWorkbench",
            arguments: [uri],
          },
        });
      }

      const actions: Array<{ id: string; title: string; category?: string }> =
        (detectedPlugin.languageDef as any)?.actions ?? [];
      if (actions.length > 0) {
        let emittedSim = false;
        for (const action of actions) {
          const cat = action.category ?? "query";
          if (cat === "simulate") {
            if (!showSimulate || (emittedSim && !showVerification && !showFileConversions)) continue;
            emittedSim = true;
          }
          if ((cat === "verify" || cat === "query") && !showVerification) continue;
          if ((cat === "transform" || cat === "export") && !showFileConversions) continue;
          const prefix = cat === "simulate" ? "▶ " : cat === "verify" || cat === "query" ? "✓ " : "⇄ ";
          lenses.push({
            range: headerRange,
            command: {
              title: `${prefix}${action.title}`,
              command: `modelscript.${detectedPlugin.id}.${action.id}`,
              arguments: [uri],
            },
          });
        }
      } else if (detectedPlugin.actionHandlers) {
        let emittedSim = false;
        for (const actionId of Object.keys(detectedPlugin.actionHandlers)) {
          const isSim = actionId.includes("simulate") || actionId.includes("solve") || actionId.includes("run");
          const isExport = actionId.includes("export") || actionId.includes("project") || actionId.includes("_to_");
          if (isSim) {
            if (!showSimulate || (emittedSim && !showVerification && !showFileConversions)) continue;
            emittedSim = true;
          } else if (isExport) {
            if (!showFileConversions) continue;
          } else {
            if (!showVerification) continue;
          }
          const prefix = isSim ? "▶ " : isExport ? "⇄ " : "✓ ";
          const humanTitle = humanizeActionId(actionId);
          lenses.push({
            range: headerRange,
            command: {
              title: `${prefix}${humanTitle}`,
              command: `modelscript.${detectedPlugin.id}.${actionId}`,
              arguments: [uri],
            },
          });
        }
      } else if (detectedPlugin.id === "owl2" && showVerification) {
        lenses.push({
          range: headerRange,
          command: {
            title: "✓ Verify Ontology Consistency (Description Logic Tableau)",
            command: "modelscript.openContractExplorer",
            arguments: [uri],
          },
        });
      } else if (detectedPlugin.id === "csv" && showSimulate) {
        lenses.push({
          range: headerRange,
          command: {
            title: "📊 Plot CSV Telemetry Series",
            command: "modelscript.openSimulationView",
            arguments: [uri],
          },
        });
      } else if (detectedPlugin.id === "modelscript") {
        if (showSimulate) {
          lenses.push({
            range: headerRange,
            command: {
              title: "▶ Simulate ModelScript Study",
              command: "modelscript.action.simulate",
              arguments: [uri],
            },
          });
        }
        if (showVerification) {
          lenses.push({
            range: headerRange,
            command: {
              title: "✓ Verify Formal Contracts",
              command: "modelscript.openContractExplorer",
              arguments: [uri],
            },
          });
        }
      }

      if ((detectedPlugin.id === "pscad" || /\.(pscx|pslx)$/i.test(uri)) && currentText) {
        const xmlDoc = parseXmlSync(currentText);
        if (xmlDoc.root) {
          const lineOffsets = computeLineOffsets(currentText);
          const walkPscad = (el: XmlElement): void => {
            const tag = (el.name.includes(":") ? el.name.slice(el.name.indexOf(":") + 1) : el.name).toLowerCase();
            if (tag === "definition" && showDiagram) {
              const defName = getXmlAttr(el, "name");
              if (defName) {
                const col = currentText.indexOf(defName, el.start);
                const pos = offsetToPosition(el.start, lineOffsets);
                const namePos = col !== -1 && col < el.end ? offsetToPosition(col, lineOffsets) : pos;
                lenses.push({
                  range: Range.create(
                    namePos.line,
                    namePos.character,
                    namePos.line,
                    namePos.character + defName.length,
                  ),
                  command: {
                    title: `⊞ Open Schematic Sub-Page '${defName}'`,
                    command: "modelscript.openDiagram",
                    arguments: [uri, defName],
                  },
                });
              }
            } else if (tag === "user") {
              const defn = getXmlAttr(el, "defn");
              if (defn) {
                const compId = getXmlAttr(el, "id") ?? defn;
                const col = currentText.indexOf(defn, el.start);
                const pos = offsetToPosition(el.start, lineOffsets);
                const namePos = col !== -1 && col < el.end ? offsetToPosition(col, lineOffsets) : pos;
                const range = Range.create(
                  namePos.line,
                  namePos.character,
                  namePos.line,
                  namePos.character + defn.length,
                );
                if (containsCaseInsensitiveAny(defn, ["tline", "cable"]) && (showSimulate || showDiagram)) {
                  lenses.push({
                    range,
                    command: {
                      title: `🗼 Inspect Line Constants & Tower Geometry (${defn})`,
                      command: "modelscript.pscad.inspect_line_constants",
                      arguments: [uri, compId],
                    },
                  });
                } else if (
                  containsCaseInsensitiveAny(defn, ["inverter", "ibr", "grid_forming", "vsc", "statcom"]) &&
                  (showVerification || showSimulate)
                ) {
                  lenses.push({
                    range,
                    command: {
                      title: `✓ Verify IEEE 2800 Ride-Through & Sequence Current (${defn})`,
                      command: "modelscript.pscad.verify_ieee2800",
                      arguments: [uri, compId],
                    },
                  });
                }
              }
            }
            for (const child of el.children) {
              walkPscad(child);
            }
          };
          walkPscad(xmlDoc.root);
        }
      }
    }

    return lenses;
  });
}

function computeLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function offsetToPosition(offset: number, lineOffsets: number[]): { line: number; character: number } {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineOffsets[mid]! <= offset) low = mid + 1;
    else high = mid - 1;
  }
  const line = Math.max(0, low - 1);
  return { line, character: offset - (lineOffsets[line] ?? 0) };
}

function getXmlAttr(el: XmlElement, ...names: string[]): string | undefined {
  for (const name of names) {
    const lower = name.toLowerCase();
    for (const a of el.attributes) {
      if (a.name.toLowerCase() === lower) return a.value;
    }
  }
  return undefined;
}
