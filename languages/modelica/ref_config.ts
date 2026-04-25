import type { RefHook } from "@modelscript/polyglot/runtime";

export const REF_HOOKS: RefHook[] = [
  {
    ruleName: "ExtendsClause",
    namePath: "typeSpecifier",
    targetKinds: ["Class"],
    resolve: "qualified",
  },
  {
    ruleName: "TypeSpecifier",
    namePath: "name",
    targetKinds: ["Class"],
    resolve: "qualified",
  },
  {
    ruleName: "ComponentReference",
    namePath: "part",
    targetKinds: ["Component", "Class"],
    resolve: "qualified",
  },
];
