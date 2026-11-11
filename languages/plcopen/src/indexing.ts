// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plcopen — Declarative Multi-File Indexing.
 *
 * Indexes IEC 61131-3 PLCopen XML and Structured Text files (.xml, .plcopen, .plcopen.xml, .st),
 * emitting POUs (programs, function blocks, functions), variables, data types, tasks, and configurations.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parsePlcopen } from "./parser/index.js";
import type { PlcProject } from "./types.js";

export function indexPlcopenFile(ctx: DslIndexFileContext): void {
  const project = parsePlcopen(ctx.text, ctx.uri);
  ctx.setParsedModel(project);

  // 1. Index Data Types
  for (const dt of project.dataTypes) {
    ctx.addSymbol(
      dt.name,
      "Type",
      null,
      dt.range?.startOffset ?? 0,
      dt.range?.endOffset ?? 0,
      {
        kind: dt.kind,
        baseType: dt.baseType,
      },
      {
        ruleName: "plc_data_type",
        namePath: dt.name,
      },
    );
  }

  // 2. Index POUs
  for (const pou of project.pous) {
    const kindStr = pou.pouType === "function" ? "Function" : "Class";
    const pouId = ctx.addSymbol(
      pou.name,
      kindStr,
      null,
      pou.range.startOffset,
      pou.range.endOffset,
      {
        pouType: pou.pouType,
        returnType: pou.returnType,
        variablesCount: pou.variables.length,
        statementsCount: pou.body.st?.statements.length ?? 0,
      },
      {
        ruleName: `plc_${pou.pouType}`,
        namePath: pou.name,
      },
    );

    // Variables inside POU
    for (const v of pou.variables) {
      const varKind = v.scope === "input" || v.scope === "output" || v.scope === "inOut" ? "Component" : "Variable";
      ctx.addSymbol(
        v.name,
        varKind,
        pouId,
        v.range.startOffset,
        v.range.endOffset,
        {
          scope: v.scope,
          dataType: v.dataType,
          address: v.address,
          initialValue: v.initialValue,
        },
        {
          ruleName: `plc_variable_${v.scope}`,
          namePath: `${pou.name}.${v.name}`,
        },
      );
    }
  }

  // 3. Index Configurations & Tasks
  for (const config of project.configurations) {
    const configId = ctx.addSymbol(
      config.name,
      "Package",
      null,
      config.range?.startOffset ?? 0,
      config.range?.endOffset ?? 0,
      {
        resourceCount: config.resources.length,
      },
      {
        ruleName: "plc_configuration",
        namePath: config.name,
      },
    );

    for (const res of config.resources) {
      for (const task of res.tasks) {
        ctx.addSymbol(
          task.name,
          "Event",
          configId,
          task.range?.startOffset ?? 0,
          task.range?.endOffset ?? 0,
          {
            priority: task.priority,
            interval: task.interval,
            intervalMs: task.intervalMs,
          },
          {
            ruleName: "plc_task",
            namePath: `${config.name}.${res.name}.${task.name}`,
          },
        );
      }
    }
  }
}

export function getPlcopenProject(workspace: UnifiedWorkspace, uri: string): PlcProject | undefined {
  return workspace.getParsedModel<PlcProject>(uri);
}

export function resolvePlcopenInScope(
  workspace: UnifiedWorkspace,
  name: string,
  scopeId: SymbolId | null,
  uri: string,
): SymbolEntry | null {
  const idx = workspace.getFileIndex(uri);
  if (idx && scopeId !== null) {
    const children = idx.childrenOf.get(scopeId);
    if (children) {
      for (const cid of children) {
        const sym = idx.symbols.get(cid);
        if (sym && sym.name.toLowerCase() === name.toLowerCase()) {
          return sym;
        }
      }
    }
  }

  return workspace.findSymbolsByName(name)[0] ?? null;
}
