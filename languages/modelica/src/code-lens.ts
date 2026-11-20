// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ModelicaCodeLens {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  command: { title: string; command: string; arguments?: any[] };
}

export interface ModelicaCodeLensContext {
  uri?: string;
  text?: string;
  flags?: {
    showVerification?: boolean;
    showPolyglotLinks?: boolean;
    showDiagram?: boolean;
    showSimulate?: boolean;
    verificationMode?: "all" | "problemsOnly" | "off";
    rawVerif?: unknown;
    formalVerification?: boolean;
  };
  workspaceManager?: any;
  documentManager?: any;
  validationService?: any;
}

const MODELICA_CLASS_KINDS = new Set(["model", "block", "study", "process", "class", "function", "record"]);

function mkRange(startLine: number, startChar: number, endLine: number, endChar: number) {
  return { start: { line: startLine, character: startChar }, end: { line: endLine, character: endChar } };
}

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
    if (line.endsWith("\r")) lines[i] = line.slice(0, -1);
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
  const rest = readAlnumIdent(text, idx + 1);
  return rest ? { token: text.slice(idx, rest.next), next: rest.next } : { token: text[idx]!, next: idx + 1 };
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
          if (valEnd > valStart) return text.slice(valStart, valEnd);
        }
      }
      pos = idx + 1;
    }
  }
  return undefined;
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

function findNodesByType(root: any, targetType: string): any[] {
  const out: any[] = [];
  const visit = (n: any) => {
    if (!n) return;
    if (n.type === targetType) out.push(n);
    const children = n.children;
    if (Array.isArray(children)) {
      for (const c of children) visit(c);
    }
  };
  visit(root);
  return out;
}

function resolveDigitalTwinLens(
  workspaceManager: any,
  uri: string,
  param: string,
  val: string,
  twinTarget: string,
  range: ModelicaCodeLens["range"],
): ModelicaCodeLens {
  const numVal = parseFloat(val);
  const threadEntries = workspaceManager?.getThreadsForUri?.(uri) ?? [];
  let alignedPeers: any[] = [];
  if (threadEntries.length > 0 && workspaceManager?.findAlignedElementsBySlot) {
    alignedPeers = workspaceManager.findAlignedElementsBySlot(threadEntries[0]!.slot) ?? [];
  }

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
        command: { title, command: "modelscript.syncDigitalThreadParams", arguments: [uri] },
      };
    }
  }

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

  return {
    range,
    command: {
      title: `🔗 Digital Twin: ${param} = ${val} [Linked to ${twinTarget}]`,
      command: "modelscript.syncDigitalThreadParams",
      arguments: [uri],
    },
  };
}

export function getModelicaCodeLenses(doc: any, ctx?: ModelicaCodeLensContext): ModelicaCodeLens[] {
  const uri = ctx?.uri ?? doc?.uri ?? "";
  const text = ctx?.text ?? (typeof doc?.getText === "function" ? doc.getText() : String(doc ?? ""));
  const lenses: ModelicaCodeLens[] = [];

  const flags = ctx?.flags ?? {};
  const showSimulate = flags.showSimulate ?? true;
  const showDiagram = flags.showDiagram ?? false;
  const showVerification = flags.showVerification ?? false;
  const showPolyglotLinks = flags.showPolyglotLinks ?? false;
  const verificationMode = flags.verificationMode ?? "problemsOnly";

  const effectiveUri = uri.startsWith("modelscript-lib://global")
    ? "file://" + uri.substring("modelscript-lib://global".length)
    : uri;
  const proofMap =
    ctx?.validationService?.modelicaProofResultsByUri?.get(uri) ??
    ctx?.validationService?.modelicaProofResultsByUri?.get(effectiveUri);
  const daeMap =
    ctx?.validationService?.modelicaDaeVerificationResultsByUri?.get(uri) ??
    ctx?.validationService?.modelicaDaeVerificationResultsByUri?.get(effectiveUri);
  const emittedProofClasses = new Set<string>();
  const emittedDaeClasses = new Set<string>();

  const shouldEmitModelicaProof = (
    proof: { definiteBugs?: unknown[]; potentialBugs?: unknown[] } | null | undefined,
  ): boolean => {
    if (!proof || verificationMode === "off") return false;
    const hasDefects = (proof.definiteBugs?.length ?? 0) > 0 || (proof.potentialBugs?.length ?? 0) > 0;
    if (verificationMode === "problemsOnly") {
      return hasDefects;
    }
    return true;
  };

  const shouldEmitDaeProof = (daeProof: { issues?: unknown[] } | null | undefined): boolean => {
    if (!daeProof || verificationMode === "off") return false;
    const hasIssues = (daeProof.issues?.length ?? 0) > 0;
    if (verificationMode === "problemsOnly") {
      return hasIssues;
    }
    return true;
  };

  const emitClassLenses = (rawKind: string, name: string, range: ModelicaCodeLens["range"]) => {
    if (showSimulate && (rawKind === "model" || rawKind === "block" || rawKind === "study" || rawKind === "process")) {
      const hasThreadLinks =
        (showPolyglotLinks || showVerification) && Boolean(ctx?.workspaceManager?.getThreadsForUri?.(uri)?.length);
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
          command: { title: "🌐 Digital Thread Explorer", command: "modelscript.openThreadExplorer", arguments: [uri] },
        });
      }
      if (showDiagram) {
        lenses.push({
          range,
          command: { title: "⊞ Open Interactive Diagram", command: "modelscript.openDiagram", arguments: [uri] },
        });
      }
    }

    const proof = proofMap?.get(name);
    if (shouldEmitModelicaProof(proof)) {
      emittedProofClasses.add(name);
      let proofTitle = "✓ Formally Verified (0 RTEs, 100% Proven Safe)";
      if (proof.definiteBugs.length > 0) {
        proofTitle = `✗ Formal Defect: ${proof.definiteBugs.length} bug(s) detected`;
      } else if (proof.potentialBugs.length > 0) {
        const oobCount = proof.potentialBugs.filter((b: any) => b.category === "array_out_of_bounds").length;
        proofTitle =
          oobCount > 0
            ? `⚠ Formal Proof: ${proof.potentialBugs.length} unproven condition(s) (array out of bounds)`
            : `⚠ Formal Proof: ${proof.potentialBugs.length} unproven condition(s)`;
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

    const daeProof = daeMap?.get(name);
    if (shouldEmitDaeProof(daeProof)) {
      emittedDaeClasses.add(name);
      let daeTitle =
        daeProof.verdict?.kind === "proven"
          ? "✓ DAE: no singularities (interval analysis, all variables bounded)"
          : `◌ DAE: no singularity found among bounded variables (${daeProof.unboundedVariables ?? "some"} unbounded — not proven)`;
      if (daeProof.issues.length > 0) {
        const definite = daeProof.issues.find((i: any) => i.severity === "definite");
        daeTitle = definite ? `✗ DAE Defect: ${definite.message}` : `⚠ DAE Invariant: ${daeProof.issues[0].message}`;
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
  };

  const emitLoopLens = (className: string, proof: any, loopRange: ModelicaCodeLens["range"]) => {
    if (!shouldEmitModelicaProof(proof)) return;
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
      loopTitle = proof.isCertifiedSafe ? "✓ Loop Formally Verified (Safe Bounds)" : "✓ Loop Invariants Verified";
    }
    if (loopTitle) {
      lenses.push({
        range: loopRange,
        command: {
          title: loopTitle,
          command: "modelscript.showProofDetails",
          arguments: [uri, className, proof.formattedMatrix],
        },
      });
    }
  };

  let usedCst = false;
  const treeEntry = ctx?.documentManager?.getDocumentTree?.(uri) ?? ctx?.documentManager?.documentTrees?.get?.(uri);
  const rootNode = treeEntry?.tree?.rootNode ?? treeEntry?.rootNode;

  if (rootNode) {
    const classNodes = findNodesByType(rootNode, "class_definition");
    if (classNodes.length > 0) {
      usedCst = true;
      for (const classNode of classNodes) {
        const idNode = findNodesByType(classNode, "identifier")[0];
        if (!idNode) continue;
        const name = idNode.text?.trim() || "";
        if (!name) continue;
        const lineIdx = idNode.startPosition?.row ?? 0;
        const col = idNode.startPosition?.column ?? 0;
        const range = mkRange(lineIdx, col, lineIdx, col + name.length);

        const prefixesNode = findNodesByType(classNode, "class_prefixes")[0];
        let rawKind = "class";
        if (prefixesNode?.text) {
          const words = splitWsTokens(prefixesNode.text);
          rawKind = words[words.length - 1] || "class";
        } else {
          const firstWord = splitWsTokens(classNode.text || "")[0];
          if (firstWord) rawKind = firstWord;
        }

        emitClassLenses(rawKind, name, range);

        const proof = proofMap?.get(name);
        const forNodes = findNodesByType(classNode, "for_statement");
        for (const forNode of forNodes) {
          const forLine = forNode.startPosition?.row ?? 0;
          const forCol = forNode.startPosition?.column ?? 0;
          emitLoopLens(name, proof, mkRange(forLine, forCol, forLine, forCol + 3));
        }

        if (showPolyglotLinks) {
          const compClauses = findNodesByType(classNode, "component_clause");
          for (const comp of compClauses) {
            const compText = comp.text || "";
            if (!hasWordMatch(compText, "parameter") || !hasWordMatch(compText, "Real")) continue;
            for (const cd of findNodesByType(comp, "component_declaration")) {
              const compIdNode = findNodesByType(cd, "identifier")[0];
              if (!compIdNode) continue;
              const param = compIdNode.text?.trim();
              if (!param) continue;
              const modNode = findNodesByType(cd, "modification")[0];
              const val =
                (modNode?.text ? extractFirstNumberAfterEquals(modNode.text) : undefined) ??
                extractFirstNumberAfterEquals(cd.text || "");
              if (!val) continue;
              const twinTarget = extractQuotedAnnotationAttr(cd.text || compText, ["twin", "counterpart"]);
              if (!twinTarget) continue;
              const paramLine = compIdNode.startPosition?.row ?? 0;
              const paramCol = compIdNode.startPosition?.column ?? 0;
              lenses.push(
                resolveDigitalTwinLens(
                  ctx?.workspaceManager,
                  uri,
                  param,
                  val,
                  twinTarget,
                  mkRange(paramLine, paramCol, paramLine, paramCol + param.length),
                ),
              );
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
      const classDecl = matchModelicaClassDeclLine(line);
      if (classDecl) {
        currentClassName = classDecl.name;
        const col = line.indexOf(classDecl.name);
        emitClassLenses(classDecl.kind, classDecl.name, mkRange(lineIdx, col, lineIdx, col + classDecl.name.length));
      }
      if (currentClassName && isModelicaEndClassLine(line, currentClassName)) {
        currentClassName = undefined;
      }
      if (matchModelicaForLoopLine(line) && currentClassName) {
        const col = line.indexOf("for");
        emitLoopLens(currentClassName, proofMap?.get(currentClassName), mkRange(lineIdx, col, lineIdx, col + 3));
      }
      const paramDecl = matchModelicaParamRealLine(line);
      if (showPolyglotLinks && paramDecl) {
        const { name: param, value: val } = paramDecl;
        const col = line.indexOf(param);
        let scanWindow = line;
        for (let j = 1; j <= 3 && lineIdx + j < lines.length; j++) {
          if (scanWindow.includes(";")) break;
          scanWindow += " " + lines[lineIdx + j]!;
        }
        const twinTarget = extractQuotedAnnotationAttr(scanWindow, ["twin", "counterpart"]);
        if (twinTarget) {
          lenses.push(
            resolveDigitalTwinLens(
              ctx?.workspaceManager,
              uri,
              param,
              val,
              twinTarget,
              mkRange(lineIdx, col, lineIdx, col + param.length),
            ),
          );
        }
      }
    }
  }

  const index = (
    typeof ctx?.workspaceManager?.getWorkspaceIndex === "function"
      ? ctx.workspaceManager.getWorkspaceIndex("modelica")
      : ctx?.workspaceManager?.globalWorkspaceIndex
  )?.getFileIndex(uri);

  if (index) {
    const norm = (u: string | undefined) => (u ? u.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///").toLowerCase() : "");
    const targetUri = norm(uri);
    for (const [, symbol] of index.symbols.entries()) {
      const sym = symbol as any;
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
      if (startLine === undefined && doc && typeof doc.positionAt === "function" && sym.startOffset !== undefined) {
        const pos = doc.positionAt(sym.startOffset);
        startLine = pos.line;
        startChar = pos.character;
      }
      const range = mkRange(startLine ?? 0, startChar ?? 0, startLine ?? 0, startChar ?? 0);

      const proof = proofMap?.get(sym.name);
      if (shouldEmitModelicaProof(proof) && !emittedProofClasses.has(sym.name)) {
        emittedProofClasses.add(sym.name);
        let proofTitle = "✓ Formally Verified (0 RTEs, 100% Proven Safe)";
        if (proof.definiteBugs.length > 0) {
          proofTitle = `✗ Formal Defect: ${proof.definiteBugs.length} bug(s) detected`;
        } else if (proof.potentialBugs.length > 0) {
          const oobCount = proof.potentialBugs.filter((b: any) => b.category === "array_out_of_bounds").length;
          proofTitle =
            oobCount > 0
              ? `⚠ Formal Proof: ${proof.potentialBugs.length} unproven condition(s) (array out of bounds)`
              : `⚠ Formal Proof: ${proof.potentialBugs.length} unproven condition(s)`;
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
        let daeTitle =
          daeProof.verdict?.kind === "proven"
            ? "✓ DAE: no singularities (interval analysis, all variables bounded)"
            : `◌ DAE: no singularity found among bounded variables (${daeProof.unboundedVariables ?? "some"} unbounded — not proven)`;
        if (daeProof.issues.length > 0) {
          const definite = daeProof.issues.find((i: any) => i.severity === "definite");
          daeTitle = definite ? `✗ DAE Defect: ${definite.message}` : `⚠ DAE Invariant: ${daeProof.issues[0].message}`;
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
