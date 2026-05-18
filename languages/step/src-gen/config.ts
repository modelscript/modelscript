import type { IndexerHook, RefHook } from "@modelscript/compiler";

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
