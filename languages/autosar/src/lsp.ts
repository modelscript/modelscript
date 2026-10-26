// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { lowerAutosarToDae } from "./dae/autosar-to-dae.js";
import { lintAutosarModel } from "./lints/rules.js";
import { parseArxml } from "./parser/arxml-parser.js";
import { autosarToModelica } from "./projections/modelica.js";
import { autosarToSysml } from "./projections/sysml.js";
import { VirtualRte } from "./rte/virtual-rte.js";
import type { AutosarModel, AutosarPackage, AutosarSwComponent } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4; // 1=Error, 2=Warning, 3=Info, 4=Hint
  code?: string | number | undefined;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

/**
 * Validates an AUTOSAR document and produces LSP diagnostics.
 */
export function validateAutosar(content: string, _uri: string = "model.arxml"): LspDiagnostic[] {
  try {
    const model = parseArxml(content);
    const rawDiags = lintAutosarModel(model);

    return rawDiags.map((d) => ({
      range: {
        start: { line: Math.max(0, d.range.startLine - 1), character: Math.max(0, d.range.startColumn - 1) },
        end: { line: Math.max(0, d.range.endLine - 1), character: Math.max(0, d.range.endColumn) },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "modelscript-autosar",
      message: d.message,
    }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "M7400",
        source: "modelscript-autosar",
        message: `ARXML parsing error: ${msg}`,
      },
    ];
  }
}

function extractPackageSymbols(pkg: AutosarPackage): LspDocumentSymbol {
  const children: LspDocumentSymbol[] = [];

  for (const [elName, el] of pkg.elements) {
    if ("kind" in el && typeof el.kind === "string" && el.kind.includes("SW-COMPONENT")) {
      const swc = el as AutosarSwComponent;
      const portChildren: LspDocumentSymbol[] = [];
      for (const [pName, port] of swc.ports) {
        portChildren.push({
          name: pName,
          detail: `${port.direction} (${port.interfaceRef.split("/").pop() ?? ""})`,
          kind: LspSymbolKind.Field,
          range: {
            start: { line: (port.range?.startLine ?? 1) - 1, character: (port.range?.startColumn ?? 1) - 1 },
            end: { line: (port.range?.endLine ?? 1) - 1, character: port.range?.endColumn ?? 0 },
          },
          selectionRange: {
            start: { line: (port.range?.startLine ?? 1) - 1, character: (port.range?.startColumn ?? 1) - 1 },
            end: { line: (port.range?.endLine ?? 1) - 1, character: port.range?.endColumn ?? 0 },
          },
        });
      }

      children.push({
        name: elName,
        detail: swc.kind,
        kind: LspSymbolKind.Class,
        range: {
          start: { line: (swc.range?.startLine ?? 1) - 1, character: (swc.range?.startColumn ?? 1) - 1 },
          end: { line: (swc.range?.endLine ?? 1) - 1, character: swc.range?.endColumn ?? 0 },
        },
        selectionRange: {
          start: { line: (swc.range?.startLine ?? 1) - 1, character: (swc.range?.startColumn ?? 1) - 1 },
          end: { line: (swc.range?.endLine ?? 1) - 1, character: swc.range?.endColumn ?? 0 },
        },
        children: portChildren.length > 0 ? portChildren : undefined,
      });
    } else {
      children.push({
        name: elName,
        detail: "kind" in el ? String((el as any).kind) : "Element",
        kind: LspSymbolKind.Interface,
        range: {
          start: { line: (el.range?.startLine ?? 1) - 1, character: (el.range?.startColumn ?? 1) - 1 },
          end: { line: (el.range?.endLine ?? 1) - 1, character: el.range?.endColumn ?? 0 },
        },
        selectionRange: {
          start: { line: (el.range?.startLine ?? 1) - 1, character: (el.range?.startColumn ?? 1) - 1 },
          end: { line: (el.range?.endLine ?? 1) - 1, character: el.range?.endColumn ?? 0 },
        },
      });
    }
  }

  for (const sub of pkg.subPackages.values()) {
    children.push(extractPackageSymbols(sub));
  }

  const pRange: LspRange = {
    start: { line: (pkg.range?.startLine ?? 1) - 1, character: (pkg.range?.startColumn ?? 1) - 1 },
    end: { line: (pkg.range?.endLine ?? 1) - 1, character: pkg.range?.endColumn ?? 0 },
  };

  return {
    name: pkg.shortName,
    detail: "AR-PACKAGE",
    kind: LspSymbolKind.Package,
    range: pRange,
    selectionRange: pRange,
    children: children.length > 0 ? children : undefined,
  };
}

/**
 * Extracts hierarchical LSP document symbols from an AUTOSAR document.
 */
export function getAutosarDocumentSymbols(content: string, _uri: string = "model.arxml"): LspDocumentSymbol[] {
  try {
    const model = parseArxml(content);
    const symbols: LspDocumentSymbol[] = [];
    for (const pkg of model.packages.values()) {
      symbols.push(extractPackageSymbols(pkg));
    }
    return symbols;
  } catch {
    return [];
  }
}

/**
 * Provides hover information for symbols in an AUTOSAR model.
 */
export function getAutosarHover(
  content: string,
  position: LspPosition,
  _uri: string = "model.arxml",
): LspHover | undefined {
  try {
    const model = parseArxml(content);
    const targetLine = position.line + 1;

    for (const swc of model.components.values()) {
      if (swc.range && targetLine >= swc.range.startLine && targetLine <= swc.range.endLine) {
        // Check ports
        for (const [pName, port] of swc.ports) {
          if (port.range && targetLine >= port.range.startLine && targetLine <= port.range.endLine) {
            return {
              contents: {
                kind: "markdown",
                value: `### AUTOSAR Port \`${pName}\`\n- **Direction**: ${port.direction}\n- **Interface**: \`${port.interfaceRef}\``,
              },
            };
          }
        }

        return {
          contents: {
            kind: "markdown",
            value: `### AUTOSAR SWC \`${swc.shortName}\`\n- **Kind**: ${swc.kind}\n- **Ports**: ${swc.ports.size}\n- **Runnables**: ${swc.internalBehavior?.runnables.size ?? 0}`,
          },
        };
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Executes domain actions on an AUTOSAR model.
 */
export async function executeAutosarAction(action: string, args: Record<string, unknown>): Promise<any> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const model: AutosarModel = parseArxml(content);

  switch (action) {
    case "lint":
      return lintAutosarModel(model);

    case "to_modelica":
      return autosarToModelica(model);

    case "to_sysml":
      return autosarToSysml(model);

    case "to_dae": {
      const dae = lowerAutosarToDae(model);
      return {
        varCount: dae.varCount,
        eqCount: dae.eqCount,
      };
    }

    case "simulate_rte": {
      const duration = typeof args["duration"] === "number" ? args["duration"] : 0.1;
      const dt = typeof args["dt"] === "number" ? args["dt"] : 0.01;
      const rte = new VirtualRte(model);
      return rte.runUntil(duration, dt);
    }

    default:
      throw new Error(`Unknown AUTOSAR action: ${action}`);
  }
}
