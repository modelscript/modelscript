import type { IndexerHook, RefHook } from "@modelscript/compiler";

export const INDEXER_HOOKS: IndexerHook[] = [
  {
    ruleName: "SourceFile",
    kind: "Class",
    namePath: "rows",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "CSVVirtualComponent",
    kind: "Component",
    namePath: "syntax",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
];

export const REF_HOOKS: RefHook[] = [];
