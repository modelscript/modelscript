import type { IndexerHook } from "@modelscript/polyglot/runtime";

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
