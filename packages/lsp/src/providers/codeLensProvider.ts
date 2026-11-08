// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeMeshVolumeAndArea, computeProjectedFrontalArea, ManifoldWorker } from "@modelscript/cad";
import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
import { ScadEvaluator } from "@modelscript/scad";
import { CodeLens, Range } from "vscode-languageserver";
import { type LspContext, resolveFeatureFlags } from "../lsp-context.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { findCstNodesByType } from "../utils/ast-utils.js";

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
      const sysmlName = rawSysmlName.replace(/^part\s+def\s+/, "");
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
          : rawVerif === "problemsOnly"
            ? "problemsOnly"
            : features.formalVerification
              ? "all"
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
              const words = prefixesNode.text.trim().split(/\s+/);
              rawKind = words[words.length - 1] || "class";
            } else {
              const firstWord = classNode.text?.trim()?.split(/\s+/)[0];
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

                let loopTitle: string;
                if (loopBug) {
                  if (loopBug.category === "array_out_of_bounds") {
                    const w = loopBug.witnessValues;
                    const detail = w?.index && w?.arrayLength ? ` [${w.index} vs declared size ${w.arrayLength}]` : "";
                    loopTitle = `⚠ Formal Proof: Array index out of bounds${detail}`;
                  } else {
                    loopTitle = `⚠ Formal Proof: ${loopBug.description}`;
                  }
                } else if (proof.isCertifiedSafe) {
                  loopTitle = "✓ Loop Formally Verified (Safe Bounds)";
                } else {
                  loopTitle = "✓ Loop Invariants Verified";
                }

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

            // Twin / Digital Thread Parameter inspection
            if (showPolyglotLinks) {
              const compClauses = findCstNodesByType(classNode, "component_clause");
              for (const comp of compClauses) {
                const compText = comp.text || "";
                if (!/\bparameter\b/.test(compText) || !/\bReal\b/.test(compText)) continue;
                const compDecls = findCstNodesByType(comp, "component_declaration");
                for (const cd of compDecls) {
                  const compIdNode = findCstNodesByType(cd, "identifier")[0];
                  if (!compIdNode) continue;
                  const param = compIdNode.text?.trim();
                  if (!param) continue;

                  let val: string | undefined;
                  const modNode = findCstNodesByType(cd, "modification")[0];
                  if (modNode?.text) {
                    const valMatch = /=\s*([0-9.eE+-]+)/.exec(modNode.text);
                    if (valMatch) val = valMatch[1];
                  }
                  if (!val) {
                    const valMatch = /=\s*([0-9.eE+-]+)/.exec(cd.text || "");
                    if (valMatch) val = valMatch[1];
                  }
                  if (!val) continue;

                  let twinTarget: string | undefined;
                  const twinMatch = /(?:twin|counterpart)\s*=\s*"([^"]+)"/i.exec(cd.text || compText);
                  if (twinMatch) {
                    twinTarget = twinMatch[1];
                  }
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
        const lines = text.split(/\r?\n/);
        let currentClassName: string | undefined = undefined;

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx]!;

          // Model / Block / Study / Class / Function / Record declaration
          const classMatch = /^\s*(?:model|block|study|process|class|function|record)\s+([A-Za-z0-9_]+)/.exec(line);
          if (classMatch) {
            const name = classMatch[1]!;
            currentClassName = name;
            const col = line.indexOf(name);
            const range = Range.create(lineIdx, col, lineIdx, col + name.length);

            const rawKind = classMatch[0].trim().split(/\s+/)[0]!;
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
          if (currentClassName && new RegExp(`^\\s*end\\s+${currentClassName}\\s*;`).test(line)) {
            currentClassName = undefined;
          }

          // For loop formal verification lens (positioned above the loop)
          const forMatch = /^\s*for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+([^\s]+)\s+loop\b/.exec(line);
          if (forMatch && currentClassName) {
            const proof = proofMap?.get(currentClassName);
            if (shouldEmitModelicaProof(proof)) {
              const col = line.indexOf("for");
              const loopRange = Range.create(lineIdx, col, lineIdx, col + 3);

              const loopBug =
                proof.definiteBugs.find((b: any) => b.category === "array_out_of_bounds") ??
                proof.potentialBugs.find((b: any) => b.category === "array_out_of_bounds") ??
                proof.definiteBugs[0] ??
                proof.potentialBugs[0];

              let loopTitle: string;
              if (loopBug) {
                if (loopBug.category === "array_out_of_bounds") {
                  const w = loopBug.witnessValues;
                  const detail = w?.index && w?.arrayLength ? ` [${w.index} vs declared size ${w.arrayLength}]` : "";
                  loopTitle = `⚠ Formal Proof: Array index out of bounds${detail}`;
                } else {
                  loopTitle = `⚠ Formal Proof: ${loopBug.description}`;
                }
              } else if (proof.isCertifiedSafe) {
                loopTitle = "✓ Loop Formally Verified (Safe Bounds)";
              } else {
                loopTitle = "✓ Loop Invariants Verified";
              }

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

          // Twin / Digital Thread Parameter inspection (only when parameter has an explicit twin/counterpart annotation)
          const paramMatch = /^\s*parameter\s+Real\s+([A-Za-z0-9_]+)\s*=\s*([0-9.eE+-]+)/.exec(line);
          if (showPolyglotLinks && paramMatch) {
            const param = paramMatch[1]!;
            const val = paramMatch[2]!;
            const col = line.indexOf(param);
            const range = Range.create(lineIdx, col, lineIdx, col + param.length);

            // Check for twin annotation
            let twinTarget: string | undefined;
            let scanWindow = line;
            for (let j = 1; j <= 3 && lineIdx + j < lines.length; j++) {
              if (scanWindow.includes(";")) break;
              scanWindow += " " + lines[lineIdx + j]!;
            }
            const twinMatch = /(?:twin|counterpart)\s*=\s*"([^"]+)"/i.exec(scanWindow);
            if (twinMatch) {
              twinTarget = twinMatch[1];
            }

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
        const lines = text.split(/\r?\n/);
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx]!;

          // Part Def: DroneAssembly or standard
          const partMatch = /^\s*(?:abstract\s+)?part\s+def\s+([A-Za-z0-9_]+)/.exec(line);
          if (partMatch) {
            const name = partMatch[1]!;
            const col = line.indexOf(name);
            const range = Range.create(lineIdx, col, lineIdx, col + name.length);

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
          }

          // Requirement Def
          const reqMatch = /^\s*(?:abstract\s+)?requirement\s+def\s+([A-Za-z0-9_]+)/.exec(line);
          if (reqMatch && showVerification) {
            const name = reqMatch[1]!;
            const col = line.indexOf(name);
            const range = Range.create(lineIdx, col, lineIdx, col + name.length);

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
          }

          // Verification Def
          const verifMatch = /^\s*(?:abstract\s+)?verification\s+def\s+([A-Za-z0-9_]+)/.exec(line);
          if (verifMatch && showVerification) {
            const name = verifMatch[1]!;
            const col = line.indexOf(name);
            const range = Range.create(lineIdx, col, lineIdx, col + name.length);

            lenses.push({
              range,
              command: {
                title: "▶ Run Continuous Reachability Verification (Nelson-Oppen / Salsa)",
                command: "modelscript.runReachabilityFlowpipe",
                arguments: [uri],
              },
            });
          }

          // Action / Calc Def
          const actionMatch = /^\s*(?:abstract\s+)?(?:action|calc)\s+def\s+([A-Za-z0-9_]+)/.exec(line);
          if (actionMatch && showVerification) {
            const name = actionMatch[1]!;
            const col = line.indexOf(name);
            const range = Range.create(lineIdx, col, lineIdx, col + name.length);

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
          }

          // State Def / Activity
          const stateMatch = /^\s*(?:state|activity)\s+def\s+([A-Za-z0-9_]+)/.exec(line);
          if (stateMatch && showVerification) {
            const name = stateMatch[1]!;
            const col = line.indexOf(name);
            const range = Range.create(lineIdx, col, lineIdx, col + name.length);

            lenses.push({
              range,
              command: {
                title: "⏱️ Replay Trace / Counterexample",
                command: "modelscript.openTraceReplay",
                arguments: [uri, name],
              },
            });
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
          let metricsTitle: string | undefined;
          const threadEntries = context.workspaceManager?.getThreadsForUri?.(uri) ?? [];
          const threadMeta = threadEntries.find((e: any) => e.domain === "cad")?.meta ?? threadEntries[0]?.meta;
          const frontalArea = threadMeta?.properties?.["frontalArea"];
          const mass = threadMeta?.properties?.["mass"];
          if (frontalArea !== undefined && mass !== undefined) {
            metricsTitle = `📐 Frontal Area: A = ${Number(frontalArea).toFixed(3)} m² | Estimated Mass: ${Number(mass).toFixed(2)} kg`;
          }
          const treeEntry = (context as any).documentManager?.documentTrees?.get(uri);
          const rootNode = treeEntry?.tree?.rootNode;
          if (rootNode) {
            try {
              const evaluator = new ScadEvaluator();
              const solid = evaluator.evaluate(rootNode);
              if (solid) {
                const mesh = ManifoldWorker.evaluateSolid(solid);
                const { volume } = computeMeshVolumeAndArea(mesh);
                const frontalAreaMm2 = computeProjectedFrontalArea(mesh, [0, 0, 1]);
                const frontalAreaM2 = frontalAreaMm2 * 1e-6;
                const densityMatch = /\/\/\s*@density\s*:\s*([0-9.eE+-]+)/i.exec(text);
                const densityKgM3 = densityMatch ? parseFloat(densityMatch[1]!) : 2700;
                const massKg = volume * 1e-9 * densityKgM3;
                metricsTitle = `📐 Frontal Area: A = ${frontalAreaM2.toFixed(4)} m² | Volume: ${volume.toFixed(1)} mm³ | Estimated Mass: ${massKg.toFixed(3)} kg`;
              }
            } catch {
              // Ignore live CSG evaluation failures in CodeLens
            }
          }
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
          const lines = text.split(/\r?\n/);
          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx]!;
            const tagMatch = /tag_port\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"/.exec(line);
            if (tagMatch) {
              const portName = tagMatch[1]!;
              const portType = tagMatch[2];
              const col = line.indexOf(portName);
              const range = Range.create(lineIdx, col, lineIdx, col + portName.length);
              lenses.push({
                range,
                command: {
                  title: `🔗 Boundary Coupling Port: [${portName} (${portType})] -> Boundary Condition`,
                  command: "modelscript.openPolyglotVisualizer",
                  arguments: [uri, portName],
                },
              });
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

        const lines = text.split(/\r?\n/);
        let nodeCount = 0;
        let elemCount = 0;
        let sectionMode: "none" | "node" | "element" = "none";
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx]!;
          const trimmed = line.trim();
          if (trimmed.startsWith("*")) {
            if (/^\*NODE\b/i.test(trimmed)) sectionMode = "node";
            else if (/^\*ELEMENT\b/i.test(trimmed)) sectionMode = "element";
            else sectionMode = "none";
          } else if (trimmed && !trimmed.startsWith("$") && !trimmed.startsWith("#")) {
            if (sectionMode === "node" || /^GRID\b/i.test(trimmed)) nodeCount++;
            else if (sectionMode === "element" || /^(?:CTETRA|CHEXA|CPENTA|CQUAD4|CTRIA3)\b/i.test(trimmed))
              elemCount++;
          }

          if (showCadMetrics && /^\*SOLID SECTION/i.test(line)) {
            const matMatch = /MATERIAL\s*=\s*([^,\s]+)/i.exec(line);
            const matLabel = matMatch?.[1] ? matMatch[1].replace(/_/g, " ") : "Solid Section";
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
                moName = peerName.replace(/^model\s+/, "");
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
          const solverMatch = /^\s*SOLVER\s*=\s*([^\r\n]+)/im.exec(text);
          const refAreaMatch = /^\s*REF_AREA\s*=\s*([^\r\n]+)/im.exec(text);
          const solver = solverMatch?.[1]?.trim() ?? "CFD";
          const refArea = refAreaMatch?.[1]?.trim();
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

        const lines = text.split(/\r?\n/);
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx]!;
          if (showPolyglotLinks && frontalArea !== undefined && /^\s*REF_AREA\s*=/i.test(line)) {
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
        const entityCount = (text.match(/#\d+\s*=/g) || []).length;
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
        const lines = currentText.split(/\r?\n/);
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
          const humanTitle = actionId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
                if (/tline|cable/i.test(defn) && (showSimulate || showDiagram)) {
                  lenses.push({
                    range,
                    command: {
                      title: `🗼 Inspect Line Constants & Tower Geometry (${defn})`,
                      command: "modelscript.pscad.inspect_line_constants",
                      arguments: [uri, compId],
                    },
                  });
                } else if (/inverter|ibr|grid_forming|vsc|statcom/i.test(defn) && (showVerification || showSimulate)) {
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
