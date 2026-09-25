import { CodeLens, Range } from "vscode-languageserver";
import type { LspContext } from "../LspContext.js";

export function registerCodeLensProvider(context: LspContext) {
  context.connection.onRequest("textDocument/codeLens", (params): CodeLens[] => {
    const uri = params.textDocument.uri;
    const lenses: CodeLens[] = [];

    // 1. Modelica files (.mo)
    if (uri.endsWith(".mo")) {
      const index = context.workspaceManager.globalWorkspaceIndex.getFileIndex(uri);
      if (!index) return lenses;

      for (const [, symbol] of index.symbols.entries()) {
        const sym = symbol as any;
        const kind = sym.classKind;
        const isSimulatable =
          (kind === "study" || kind === "model" || kind === "block" || kind === "process") && sym.name;
        const proofMap = context.validationService.modelicaProofResultsByUri?.get(uri);
        const proof = proofMap?.get(sym.name);

        const range = Range.create(
          sym.selectionRange?.start.line ?? sym.range?.start?.line ?? 0,
          sym.selectionRange?.start.character ?? sym.range?.start?.character ?? 0,
          sym.selectionRange?.start.line ?? sym.range?.start?.line ?? 0,
          sym.selectionRange?.start.character ?? sym.range?.start?.character ?? 0,
        );

        if (isSimulatable) {
          const title = kind === "study" ? "▶ Run Study" : `▶ Simulate ${kind}`;
          lenses.push({
            range,
            command: {
              title,
              command: "modelscript.openSimulationView",
              arguments: [uri, symbol.name],
            },
          });
        }

        if (proof) {
          let proofTitle = "✓ Formally Verified (0 RTEs, 100% Proven Safe)";
          if (proof.definiteBugs.length > 0) {
            proofTitle = `✗ Formal Defect: ${proof.definiteBugs.length} bug(s) detected`;
          } else if (proof.potentialBugs.length > 0) {
            proofTitle = `⚠ Formal Proof: ${proof.potentialBugs.length} unproven condition(s)`;
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
      }
      return lenses;
    }

    // 2. SysML v2 files (.sysml, .kerml)
    if (uri.endsWith(".sysml") || uri.endsWith(".kerml")) {
      const document = context.documents.get(uri);
      const text = document?.getText();

      // Scan document text for action def, calc def, part def, and state def
      if (text) {
        const lines = text.split(/\r?\n/);
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx]!;

          // Action / Calc Def: Formal MC/DC Test Runner & Region Decomposition
          const actionMatch = /^\s*(?:abstract\s+)?(?:action|calc)\s+def\s+([A-Za-z0-9_]+)/.exec(line);
          if (actionMatch) {
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

          // Part Def: Contract Hierarchy & Refinement Explorer
          const partMatch = /^\s*(?:abstract\s+)?part\s+def\s+([A-Za-z0-9_]+)/.exec(line);
          if (partMatch) {
            const name = partMatch[1]!;
            const col = line.indexOf(name);
            const range = Range.create(lineIdx, col, lineIdx, col + name.length);

            lenses.push({
              range,
              command: {
                title: "🛡️ Verify Contracts & Hierarchy",
                command: "modelscript.openContractExplorer",
                arguments: [uri, name],
              },
            });
          }

          // State Def / Activity: Counterexample & Trace Replay
          const stateMatch = /^\s*(?:state|activity)\s+def\s+([A-Za-z0-9_]+)/.exec(line);
          if (stateMatch) {
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

    return lenses;
  });
}
