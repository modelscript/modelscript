import type { DiffConfig, GraphicsConfig, I18nConfig, IndexerHook, RefHook } from "@modelscript/language/compiler";

export const INDEXER_HOOKS: IndexerHook[] = [
  {
    ruleName: "HeaderEntity",
    kind: "HeaderEntity",
    namePath: "keyword",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "DataSection",
    kind: "DataSection",
    namePath: "scopeName",
    exportPaths: ["scopeName"],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "EntityInstance",
    kind: "Entity",
    namePath: "id",
    exportPaths: ["id"],
    inheritPaths: [],
    metadataFieldPaths: { entityType: "record" },
  },
  {
    ruleName: "EntityReference",
    kind: "Reference",
    namePath: "target",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
];

export const REF_HOOKS: RefHook[] = [
  {
    ruleName: "EntityReference",
    namePath: "target",
    targetKinds: ["Entity"],
    resolve: "lexical",
  },
];

export const graphicsConfig: Record<string, GraphicsConfig> = {};

export const diffConfig: Record<string, DiffConfig> = {};

export const i18nConfig: Record<string, I18nConfig> = {};
