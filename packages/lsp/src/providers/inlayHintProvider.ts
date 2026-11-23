// SPDX-License-Identifier: AGPL-3.0-or-later

import { InlayHint, InlayHintKind, Position, Range } from "vscode-languageserver";
import type { LspContext } from "../lsp-context.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";

export function registerInlayHintProvider(context: LspContext) {
  context.connection.onRequest(
    "textDocument/inlayHint",
    async (params: { textDocument: { uri: string }; range: Range }): Promise<InlayHint[]> => {
      const uri = params.textDocument.uri;
      const hints: InlayHint[] = [];

      const inlayCfg = context.settings?.inlayHints;
      if (inlayCfg?.enabled === false) {
        return hints;
      }
      const showUnitsAndBounds = inlayCfg?.unitsAndBounds ?? true;
      const showFormalProofBadges = inlayCfg?.formalProofBadges ?? false;
      const showVariabilityPrefixes = inlayCfg?.variabilityPrefixes ?? false;

      const document = context.documents.get(uri);
      if (!document) return hints;

      const plugin = globalLanguageRegistry.getPluginForLanguageIdOrUri(document.languageId, uri);
      if (plugin && !globalLanguageRegistry.isLanguageEnabled(plugin.id)) {
        return hints;
      }

      if (showUnitsAndBounds && plugin?.customHandlers?.inlayHints) {
        const pluginHints = await Promise.resolve(plugin.customHandlers.inlayHints(document, params.range));
        if (Array.isArray(pluginHints) && pluginHints.length > 0) {
          return pluginHints as InlayHint[];
        }
      }

      const fileIndex =
        plugin?.workspaceIndex?.getFileIndex?.(uri) ??
        (plugin ? context.workspaceManager.getWorkspaceIndex(plugin.id)?.getFileIndex(uri) : undefined) ??
        context.workspaceManager.getWorkspaceIndex("modelica")?.getFileIndex(uri) ??
        context.workspaceManager.getWorkspaceIndex("sysml2")?.getFileIndex(uri);

      if (!fileIndex) return hints;

      const { start: reqStart, end: reqEnd } = params.range;
      const effectiveUri = uri.startsWith("modelscript-lib://global")
        ? "file://" + uri.substring("modelscript-lib://global".length)
        : uri;
      const daeMap = showFormalProofBadges
        ? (context.validationService?.daeVerificationResultsByUri?.get(uri) ??
          context.validationService?.daeVerificationResultsByUri?.get(effectiveUri) ??
          context.validationService?.modelicaDaeVerificationResultsByUri?.get(uri) ??
          context.validationService?.modelicaDaeVerificationResultsByUri?.get(effectiveUri))
        : undefined;
      const proofMap = showFormalProofBadges
        ? (context.validationService?.modelicaProofResultsByUri?.get(uri) ??
          context.validationService?.modelicaProofResultsByUri?.get(effectiveUri))
        : undefined;
      const hasInconclusiveDae = Boolean(
        daeMap &&
        Array.from(daeMap.values()).some(
          (r: { verdict?: { kind?: string }; unboundedVariables?: number }) =>
            r && r.verdict?.kind !== "proven" && (r.unboundedVariables ?? 0) > 0,
        ),
      );

      for (const [, symbol] of fileIndex.symbols.entries()) {
        const sym = symbol as {
          name?: string;
          kind?: string;
          selectionRange?: { start?: Position; end?: Position };
          range?: { start?: Position; end?: Position };
          startOffset?: number;
          endOffset?: number;
          metadata?: { unit?: unknown; displayUnit?: unknown; variability?: unknown; causality?: unknown };
        };
        if (!sym.name) continue;

        let symStart = sym.selectionRange?.start ?? sym.range?.start;
        let symEnd = sym.selectionRange?.end ?? sym.range?.end;
        if (!symStart && sym.startOffset !== undefined) {
          symStart = document.positionAt(sym.startOffset);
        }
        if (!symEnd && sym.endOffset !== undefined) {
          symEnd = document.positionAt(sym.endOffset);
        }
        if (!symStart || !symEnd) continue;

        // Filter to requested visible range
        if (symEnd.line < reqStart.line || symStart.line > reqEnd.line) {
          continue;
        }

        // 1. Parameter Unit Inlay Hint (e.g. `R = 100` -> ` [Ω]`)
        if (showUnitsAndBounds) {
          const unit = sym.metadata?.unit ?? sym.metadata?.displayUnit;
          if (unit && typeof unit === "string") {
            hints.push({
              position: Position.create(symEnd.line, symEnd.character),
              label: ` [${unit}]`,
              kind: InlayHintKind.Type,
              paddingLeft: true,
            });
          }
        }

        // 2. Formal Proof Bound Inlay Hint (DAE reachability, abstract interpretation, or unbounded blocker)
        if (showFormalProofBadges) {
          let emittedBound = false;
          if (daeMap) {
            for (const [modelName, daeProof] of daeMap.entries()) {
              const bound = daeProof?.variableBounds?.get?.(sym.name);
              if (bound && !bound.isTop?.() && !bound.isBottom?.()) {
                hints.push({
                  position: Position.create(symEnd.line, symEnd.character),
                  label: ` ∈ ${bound.toString()}`,
                  kind: InlayHintKind.Type,
                  paddingLeft: true,
                  tooltip: `DAE reachability enclosure proven for '${sym.name}' in '${modelName}'`,
                });
                emittedBound = true;
                break;
              }
            }
          }
          if (!emittedBound && proofMap) {
            type IntervalVal = {
              isTop?: () => boolean;
              isBottom?: () => boolean;
              join?: (other: IntervalVal) => IntervalVal;
              toString: () => string;
            };
            type BlockState = { intervals?: Map<string, IntervalVal> };
            for (const [fnName, proof] of proofMap.entries()) {
              const exitStates = proof?.summary?.blockExitStates as Map<number, BlockState> | undefined;
              const entryStates = proof?.summary?.blockEntryStates as Map<number, BlockState> | undefined;
              const states = [
                ...(exitStates ? Array.from(exitStates.values()) : []),
                ...(entryStates ? Array.from(entryStates.values()) : []),
              ];
              let joined: IntervalVal | undefined = undefined;
              for (const st of states) {
                const ival = st?.intervals?.get?.(sym.name);
                if (ival && !ival.isTop?.() && !ival.isBottom?.()) {
                  joined = !joined ? ival : joined.join ? joined.join(ival) : joined;
                }
              }
              if (joined) {
                hints.push({
                  position: Position.create(symEnd.line, symEnd.character),
                  label: ` ∈ ${joined.toString()}`,
                  kind: InlayHintKind.Type,
                  paddingLeft: true,
                  tooltip: `Abstract-interpretation invariant proven for '${sym.name}' in '${fnName}'`,
                });
                emittedBound = true;
                break;
              }
            }
          }
          if (
            !emittedBound &&
            hasInconclusiveDae &&
            (sym.kind === "Component" || sym.kind === "Var") &&
            sym.metadata?.variability !== "parameter" &&
            sym.metadata?.variability !== "constant"
          ) {
            hints.push({
              position: Position.create(symEnd.line, symEnd.character),
              label: " ∈ (-∞, +∞)",
              kind: InlayHintKind.Type,
              paddingLeft: true,
              tooltip: `Unbounded variable '${sym.name}' — add (min=..., max=...) attributes to close DAE reachability proof`,
            });
          }
        }

        // 3. Inferred Causality/Flow Inlay Hint (e.g. `in` / `out`)
        if (showVariabilityPrefixes) {
          const causality = sym.metadata?.causality;
          if (causality && (causality === "input" || causality === "output")) {
            hints.push({
              position: Position.create(symStart.line, symStart.character),
              label: `${causality} `,
              kind: InlayHintKind.Parameter,
              paddingRight: true,
            });
          }
        }
      }

      return hints;
    },
  );
}
