import { sysml2Language } from "../../../languages/sysml2/src/language.js";
import { LRAutomaton } from "../../language/src/automata.js";
import { NormalizedGrammar } from "../../language/src/grammar.js";

const normalized = new NormalizedGrammar(sysml2Language);
const automaton = new LRAutomaton(normalized);

console.log("Total states:", automaton.states.length);

// Let's find states that have OwnedFeatureTyping or _Typings
for (const state of automaton.states) {
  const hasTypings = state.items.some((item) => {
    const prodName = normalized.productions[item.production.id]?.name;
    return prodName === "_Typings" || prodName === "OwnedFeatureTyping" || prodName === "FeatureTyping";
  });
  if (hasTypings) {
    console.log(`\nState ${state.id}:`);
    for (const item of state.items) {
      const prod = normalized.productions[item.production.id];
      const rhs = prod.rhs.map((s, idx) => (idx === item.dot ? `• ${s}` : s)).join(" ");
      const dotAtEnd = item.dot === prod.rhs.length ? " •" : "";
      console.log(`  ${prod.name} -> ${rhs}${dotAtEnd}  [${Array.from(item.lookahead).join(", ")}]`);
    }
    for (const [sym, nextState] of state.transitions.entries()) {
      console.log(`  --(${sym})--> State ${nextState.id}`);
    }
  }
}
