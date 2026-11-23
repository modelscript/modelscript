// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext, SyntaxNode } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseSpice } from "./parser/spice-parser.js";
import type { SpiceCircuit } from "./types.js";

type SpiceCstNodeLike = Omit<SyntaxNode, "hasError"> & { hasError?: boolean | (() => boolean) };

interface SpiceCstSubckt {
  name: string;
  ports: string[];
  componentCount: number;
  startOffset: number;
  endOffset: number;
  nameStartOffset: number;
  nameEndOffset: number;
}

interface SpiceCstModel {
  name: string;
  modelType: string;
  params: [string, string][];
  startOffset: number;
  endOffset: number;
  nameStartOffset: number;
  nameEndOffset: number;
}

interface SpiceCstComponent {
  name: string;
  kind: string;
  nodes: string[];
  value?: string | undefined;
  subcktName?: string | undefined;
  startOffset: number;
  endOffset: number;
  nameStartOffset: number;
  nameEndOffset: number;
}

function extractValidCstRoot(tree: unknown): SyntaxNode | null {
  if (!tree || typeof tree !== "object") return null;
  const candidate = ("rootNode" in tree ? (tree as { rootNode?: unknown }).rootNode : tree) as
    SpiceCstNodeLike | undefined;
  if (!candidate || typeof candidate !== "object" || typeof candidate.type !== "string") return null;
  const hasErr = typeof candidate.hasError === "function" ? candidate.hasError() : Boolean(candidate.hasError);
  if (hasErr || candidate.isError) return null;
  return candidate as SyntaxNode;
}

function cstNodeText(node: SyntaxNode, source: string): string {
  if (typeof node.text === "string" && node.text.length > 0) return node.text;
  if (typeof node.startIndex === "number" && typeof node.endIndex === "number" && node.endIndex >= node.startIndex) {
    return source.slice(node.startIndex, node.endIndex);
  }
  return "";
}

function inferSpiceComponentKind(name: string): string {
  switch (name.charAt(0).toUpperCase()) {
    case "R":
      return "resistor";
    case "C":
      return "capacitor";
    case "L":
      return "inductor";
    case "D":
      return "diode";
    case "V":
      return "voltage_source";
    case "I":
      return "current_source";
    case "Q":
      return "bjt";
    case "M":
      return "mosfet";
    case "X":
      return "subcircuit";
    default:
      return "component";
  }
}

function fieldChild(node: SyntaxNode, fieldName: string): SyntaxNode | null {
  return typeof node.childForFieldName === "function" ? node.childForFieldName(fieldName) : null;
}

function fieldChildren(node: SyntaxNode, fieldName: string): SyntaxNode[] {
  return typeof node.childrenForFieldName === "function" ? node.childrenForFieldName(fieldName) : [];
}

function extractSpiceFromCst(
  rootNode: SyntaxNode,
  source: string,
): {
  subcircuits: SpiceCstSubckt[];
  models: SpiceCstModel[];
  components: SpiceCstComponent[];
} {
  const subcircuits: SpiceCstSubckt[] = [];
  const models: SpiceCstModel[] = [];
  const components: SpiceCstComponent[] = [];

  const visitTopLevel = (node: SyntaxNode): void => {
    const type = node.type;

    if (type === "Circuit" || type === "Component" || type === "Directive") {
      for (const child of node.namedChildren ?? node.children ?? []) {
        visitTopLevel(child);
      }
      return;
    }

    if (type === "SubcktDef") {
      const nameNode =
        fieldChild(node, "name") ??
        (node.namedChildren ?? node.children ?? []).find((c) => c.type === "Identifier") ??
        null;
      const name = nameNode ? cstNodeText(nameNode, source).trim() : "";
      if (name && nameNode) {
        const portNodes = fieldChildren(node, "port");
        const ports = portNodes.map((p) => cstNodeText(p, source).trim()).filter(Boolean);
        let componentCount = 0;
        const countStack: SyntaxNode[] = [...(node.namedChildren ?? node.children ?? [])];
        while (countStack.length > 0) {
          const cur = countStack.pop();
          if (!cur) continue;
          if (
            cur.type === "TwoTerminalComponent" ||
            cur.type === "SourceComponent" ||
            cur.type === "BjtComponent" ||
            cur.type === "MosfetComponent" ||
            cur.type === "SubcircuitCall"
          ) {
            componentCount++;
          } else if (cur.type === "Component") {
            for (const c of cur.namedChildren ?? cur.children ?? []) countStack.push(c);
          }
        }
        subcircuits.push({
          name,
          ports,
          componentCount,
          startOffset: node.startIndex,
          endOffset: node.endIndex,
          nameStartOffset: nameNode.startIndex,
          nameEndOffset: nameNode.endIndex,
        });
      }
      return;
    }

    if (type === "ModelDirective") {
      const nameNode =
        fieldChild(node, "name") ??
        (node.namedChildren ?? node.children ?? []).find((c) => c.type === "Identifier") ??
        null;
      const kindNode = fieldChild(node, "kind");
      const name = nameNode ? cstNodeText(nameNode, source).trim() : "";
      if (name && nameNode) {
        const params: [string, string][] = [];
        for (const child of node.namedChildren ?? node.children ?? []) {
          if (child.type === "ParamAssignment") {
            const pNode = fieldChild(child, "param");
            const vNode = fieldChild(child, "val");
            if (pNode && vNode) {
              params.push([cstNodeText(pNode, source).trim(), cstNodeText(vNode, source).trim()]);
            }
          }
        }
        models.push({
          name,
          modelType: kindNode ? cstNodeText(kindNode, source).trim() : "",
          params,
          startOffset: node.startIndex,
          endOffset: node.endIndex,
          nameStartOffset: nameNode.startIndex,
          nameEndOffset: nameNode.endIndex,
        });
      }
      return;
    }

    if (
      type === "TwoTerminalComponent" ||
      type === "SourceComponent" ||
      type === "BjtComponent" ||
      type === "MosfetComponent" ||
      type === "SubcircuitCall"
    ) {
      const nameNode =
        fieldChild(node, "name") ??
        (node.namedChildren ?? node.children ?? []).find((c) =>
          ["TwoTerminalId", "SourceId", "BjtId", "MosfetId", "SubcktCallId"].includes(c.type),
        ) ??
        null;
      const name = nameNode ? cstNodeText(nameNode, source).trim() : "";
      if (name && nameNode) {
        const nodes: string[] = [];
        for (const f of [
          "positiveNode",
          "negativeNode",
          "collectorNode",
          "baseNode",
          "emitterNode",
          "drainNode",
          "gateNode",
          "sourceNode",
          "substrateNode",
        ]) {
          const n = fieldChild(node, f);
          if (n) {
            const txt = cstNodeText(n, source).trim();
            if (txt) nodes.push(txt);
          }
        }
        for (const n of fieldChildren(node, "node")) {
          const txt = cstNodeText(n, source).trim();
          if (txt) nodes.push(txt);
        }
        const valueNode = fieldChild(node, "value");
        const subcktNode = fieldChild(node, "subcircuitName");
        components.push({
          name,
          kind: inferSpiceComponentKind(name),
          nodes,
          value: valueNode ? cstNodeText(valueNode, source).trim() : undefined,
          subcktName: subcktNode ? cstNodeText(subcktNode, source).trim() : undefined,
          startOffset: node.startIndex,
          endOffset: node.endIndex,
          nameStartOffset: nameNode.startIndex,
          nameEndOffset: nameNode.endIndex,
        });
      }
    }
  };

  visitTopLevel(rootNode);
  return { subcircuits, models, components };
}

function deriveSpiceNameFromUri(uri: string): string {
  const filename = uri.split("/").pop() || "circuit.cir";
  return filename.replace(/\.(cir|sp|net|lib|mod)$/i, "");
}

/**
 * Content predicate for disambiguating SPICE netlists across shared extensions (`.cir`, `.sp`, `.net`).
 */
export function canIndexSpiceFile(uri: string, text = ""): boolean {
  if (/\.lib$/i.test(uri)) return true;
  return /^\s*(?:\*|\.(?:SUBCKT|MODEL|END|INCLUDE|LIB|TRAN|AC|OP|DC|PARAM)\b|[RVLCIDQMXEFGHKBSWTU]\S*\s+)/im.test(text);
}

/**
 * Declarative `UnifiedWorkspace` file indexer for SPICE analog netlists (`.cir`, `.sp`, `.net`, `.lib`).
 *
 * Uses CST-first indexing from the compiled WASM `SyntaxNode` when `ctx.tree` is provided without
 * parse errors, falling back gracefully to `parseSpice(ctx.text)` when only raw source text is available.
 */
export function indexSpiceFile(ctx: DslIndexFileContext): void {
  let circuit: SpiceCircuit | null = null;
  try {
    circuit = parseSpice(ctx.text);
    ctx.setParsedModel(circuit);
  } catch {
    circuit = null;
  }

  const cstRoot = extractValidCstRoot(ctx.tree);
  if (cstRoot) {
    const cstData = extractSpiceFromCst(cstRoot, ctx.text);
    const circuitTitle = circuit?.title || deriveSpiceNameFromUri(ctx.uri);

    const rootId = ctx.addSymbol(
      circuitTitle,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        language: "spice",
        componentCount: cstData.components.length || (circuit?.components.length ?? 0),
        subcircuitCount: cstData.subcircuits.length || (circuit?.subcircuits.size ?? 0),
        modelCount: cstData.models.length || (circuit?.models.size ?? 0),
      },
      {
        ruleName: "spice_circuit",
        namePath: circuitTitle,
      },
    );

    const addCstChild = (
      name: string,
      kind: string,
      ruleName: string,
      startOffset: number,
      endOffset: number,
      nameStartOffset: number,
      nameEndOffset: number,
      meta: Record<string, unknown>,
    ) => {
      const upper = name.toUpperCase();
      ctx.addSymbol(
        name,
        kind,
        rootId,
        startOffset,
        endOffset,
        {
          language: "spice",
          ...meta,
        },
        {
          ruleName,
          namePath: `${circuitTitle}.${name}`,
          aliases: upper !== name ? [upper] : undefined,
          fieldRanges: { name: { startOffset: nameStartOffset, endOffset: nameEndOffset } },
        },
      );
    };

    for (const sub of cstData.subcircuits) {
      const parsedSub = circuit?.subcircuits.get(sub.name) ?? circuit?.subcircuits.get(sub.name.toUpperCase());
      addCstChild(
        sub.name,
        "Class",
        "spice_subcircuit",
        sub.startOffset,
        sub.endOffset,
        sub.nameStartOffset,
        sub.nameEndOffset,
        {
          ports: parsedSub?.ports ?? sub.ports,
          componentCount: parsedSub?.components.length ?? sub.componentCount,
        },
      );
    }

    for (const model of cstData.models) {
      const parsedModel = circuit?.models.get(model.name) ?? circuit?.models.get(model.name.toUpperCase());
      addCstChild(
        model.name,
        "Class",
        "spice_model",
        model.startOffset,
        model.endOffset,
        model.nameStartOffset,
        model.nameEndOffset,
        {
          modelType: parsedModel?.type ?? model.modelType,
          params: parsedModel ? Array.from(parsedModel.params.entries()) : model.params,
        },
      );
    }

    for (const comp of cstData.components) {
      const parsedComp = circuit?.components.find((c) => c.name.toUpperCase() === comp.name.toUpperCase());
      addCstChild(
        comp.name,
        "Variable",
        "spice_component",
        comp.startOffset,
        comp.endOffset,
        comp.nameStartOffset,
        comp.nameEndOffset,
        {
          kind: parsedComp?.kind ?? comp.kind,
          nodes: parsedComp?.nodes ?? comp.nodes,
          value: parsedComp?.value ?? comp.value,
          subcktName: parsedComp?.subcktName ?? comp.subcktName,
        },
      );
    }

    return;
  }

  if (!circuit) return;

  const circuitTitle = circuit.title || deriveSpiceNameFromUri(ctx.uri);

  const rootId = ctx.addSymbol(
    circuitTitle,
    "Package",
    null,
    0,
    ctx.text.length,
    {
      language: "spice",
      componentCount: circuit.components.length,
      subcircuitCount: circuit.subcircuits.size,
      modelCount: circuit.models.size,
    },
    {
      ruleName: "spice_circuit",
      namePath: circuitTitle,
    },
  );

  const addChildSymbol = (
    name: string,
    kind: string,
    ruleName: string,
    span: { startOffset?: number; endOffset?: number } | undefined,
    meta: Record<string, unknown>,
  ) => {
    const upper = name.toUpperCase();
    ctx.addSymbol(
      name,
      kind,
      rootId,
      span?.startOffset ?? 0,
      span?.endOffset ?? 0,
      {
        language: "spice",
        ...meta,
      },
      {
        ruleName,
        namePath: `${circuitTitle}.${name}`,
        aliases: upper !== name ? [upper] : undefined,
      },
    );
  };

  for (const sub of circuit.subcircuits.values()) {
    addChildSymbol(sub.name, "Class", "spice_subcircuit", sub.span, {
      ports: sub.ports,
      componentCount: sub.components.length,
    });
  }

  for (const model of circuit.models.values()) {
    addChildSymbol(model.name, "Class", "spice_model", model.span, {
      modelType: model.type,
      params: Array.from(model.params.entries()),
    });
  }

  for (const comp of circuit.components) {
    addChildSymbol(comp.name, "Variable", "spice_component", comp.span, {
      kind: comp.kind,
      nodes: comp.nodes,
      value: comp.value,
      subcktName: comp.subcktName,
    });
  }
}

/**
 * Case-insensitive substring symbol search across SPICE netlists indexed in `workspace`.
 */
export function findSpiceSymbols(workspace: UnifiedWorkspace, query: string): SymbolEntry[] {
  const results: SymbolEntry[] = [];
  const lowerQuery = query.toLowerCase();
  const idx = workspace.getIndex();

  for (const [name, ids] of idx.byName) {
    if (name.toLowerCase().includes(lowerQuery)) {
      for (const id of ids) {
        const sym = idx.symbols.get(id);
        if (sym && sym.language === "spice" && !results.includes(sym)) {
          results.push(sym);
        }
      }
    }
  }
  return results;
}

/**
 * Resolves a SPICE subcircuit, model, or component symbol by name, preferring `fromUri` before global lookup.
 */
export function resolveSpiceQualified(
  workspace: UnifiedWorkspace,
  name: string,
  fromUri?: string,
): SymbolEntry | undefined {
  const upperName = name.toUpperCase();

  if (fromUri) {
    const localIdx = workspace.getFileIndex(fromUri);
    if (localIdx) {
      const ids = localIdx.byName.get(name) ?? localIdx.byName.get(upperName);
      const firstId = ids?.[0];
      if (firstId !== undefined) return localIdx.symbols.get(firstId);
    }
  }

  const idx = workspace.getIndex();
  const ids = idx.byName.get(name) ?? idx.byName.get(upperName);
  if (ids) {
    for (const id of ids) {
      const sym = idx.symbols.get(id);
      if (sym && sym.language === "spice") return sym;
    }
  }
  return undefined;
}

/**
 * Finds cross-file component references to a SPICE `.SUBCKT` or `.MODEL` symbol across `workspace`.
 */
export function findSpiceReferencesTo(
  workspace: UnifiedWorkspace,
  symbolId: SymbolId,
): { uri: string; startOffset: number; endOffset: number }[] {
  const refs: { uri: string; startOffset: number; endOffset: number }[] = [];
  const sym = workspace.getIndex().symbols.get(symbolId);
  if (!sym) return refs;

  const targetName = sym.name.toUpperCase();
  for (const [uri, circuit] of workspace.getAllParsedModels<SpiceCircuit>()) {
    for (const comp of circuit.components) {
      if (comp.subcktName?.toUpperCase() === targetName || comp.model?.toUpperCase() === targetName) {
        if (comp.span) {
          refs.push({
            uri,
            startOffset: comp.span.startOffset,
            endOffset: comp.span.endOffset,
          });
        }
      }
    }
  }

  return refs;
}
