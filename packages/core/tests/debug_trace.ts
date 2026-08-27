import { compileRegexToDFA } from "../../language/src/automata.js";

const pattern = "\\/\\*[^*]*\\*+([^/*][^*]*\\*+)*\\/";
const res = compileRegexToDFA([{ pattern, tokenName: "T_COMMENT" }]);

console.log("numStates:", res.numStates);
console.log("numClasses:", res.numClasses);
console.log("accepts:", res.accepts);

function testStr(s: string) {
  let state = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // Find class
    let cls = 0;
    for (const r of res.classRanges) {
      if (code >= r.s && code <= r.e) {
        cls = r.c;
        break;
      }
    }
    const next = res.table[state * res.numClasses + cls];
    console.log(`char[${i}]='${s[i]}' (${code}) -> cls=${cls} -> state ${state} to ${next}`);
    if (next === -1) {
      console.log(`STUCK at index ${i}`);
      return false;
    }
    state = next;
  }
  const acc = res.accepts[state];
  console.log("Final state:", state, "accepts:", acc);
  return acc !== null && acc !== undefined;
}

console.log("Matches '/* hello */'?", testStr("/* hello */"));
