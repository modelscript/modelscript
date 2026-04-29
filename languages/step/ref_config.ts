import type { RefHook } from "@modelscript/polyglot/runtime";

export const REF_HOOKS: RefHook[] = [
  {
    ruleName: "EntityReference",
    namePath: "target",
    targetKinds: ["Entity"],
    resolve: "lexical",
  },
];
