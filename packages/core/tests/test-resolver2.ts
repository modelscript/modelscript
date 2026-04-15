import { INDEXER_HOOKS } from "../../../languages/sysml2/polyglot/indexer_config.ts";
import { REF_HOOKS } from "../../../languages/sysml2/polyglot/ref_config.ts";
import { ScopeResolver } from "../../polyglot/src/resolver.ts";
import { WorkspaceIndex } from "../../polyglot/src/workspace-index.ts";
import { parseSysML2 } from "../src/compiler/sysml2/sysml2-bridge.ts";

const text = `
package VehicleSystem {
  port def TorquePort {
    attribute torqueValue : ZZAAA ;
  }
}
`;

const tree = parseSysML2(text);
const index = new WorkspaceIndex(INDEXER_HOOKS);
index.register("test.sysml", () => tree.rootNode);

const unified = index.toUnified();

const resolver = new ScopeResolver(unified, REF_HOOKS, INDEXER_HOOKS);
const unres = resolver.resolveAllReferences();
console.log("Unresolved References output:");
console.log(unres);

const unresolvedRef = unres[0];
if (unresolvedRef) {
  const entry = unified.symbols.get(unresolvedRef.symbolId);
  console.log("Matched Entry:", entry);
}
