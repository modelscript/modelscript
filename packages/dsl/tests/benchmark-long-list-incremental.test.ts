// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser, field, repeat, semanticToken, seq } from "@modelscript/dsl";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const listTestGrammar = {
  name: "LongListDSL",
  rules: {
    Program: ($: any) => seq("model", field("name", $.Identifier), repeat($.Equation), "end", ";"),
    Equation: ($: any) => seq("eq", field("id", $.Identifier), "=", field("val", $.Number), ";"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => /[0-9]+(\.[0-9]+)?/,
  },
  extras: ($: any) => [/\s/],
};

describe("Long List Incremental Reparse Benchmark Suite", () => {
  let activeFacade: any;
  let TreeClass: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(listTestGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_long_list_bench");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      const destPath = path.join(tmpDir, file.filename);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const [ascBin, ...ascPrefixArgs] = ascPath.startsWith("npx") ? ["npx", "asc"] : [ascPath];
    childProcess.execFileSync(
      ascBin,
      [...ascPrefixArgs, parserTs, "-o", outWasm, "--exportRuntime", "--enable", "threads", "-O0", "--runtime", "stub"],
      { stdio: "inherit" },
    );

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") +
      `\nreturn { LspFacade, Tree };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade, Tree } = getFacade();
    TreeClass = Tree;

    const memory = new WebAssembly.Memory({ initial: 128, maximum: 1024, shared: true });
    const imports = {
      env: {
        memory,
        abort: () => {},
        logNode: () => {},
        debugLog: (id: any, p1: any, p2: any, p3: any) => {
          if (id >= 9000) console.log(`[bench debugLog] id=${id} p1=${p1} p2=${p2} p3=${p3}`);
        },
      },
      JavaScript: {
        debugLog: (id: any, p1: any, p2: any, p3: any) => {
          if (id >= 9000) console.log(`[bench debugLog] id=${id} p1=${p1} p2=${p2} p3=${p3}`);
        },
        logNode: () => {},
      },
      engine: {
        debugLog: (id: any, p1: any, p2: any, p3: any) => {
          if (id >= 9000) console.log(`[bench debugLog] id=${id} p1=${p1} p2=${p2} p3=${p3}`);
        },
      },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function generateModel(count: number): string {
    const lines = [`model M`];
    for (let i = 0; i < count; i++) {
      lines.push(`  eq x_${i} = ${i}.0;`);
    }
    lines.push(`end;`);
    return lines.join("\n");
  }

  it("benchmarks incremental edit at head vs tail for N=5000 items", () => {
    const N = 5000;
    const initialCode = generateModel(N);

    // 1. Cold parse
    const tCold0 = performance.now();
    const ast1 = activeFacade.parse(initialCode);
    const tCold = performance.now() - tCold0;
    expect(ast1).toBeGreaterThan(0);
    console.log(`\n[LongListDSL N=${N}] Cold Parse: ${tCold.toFixed(2)} ms`);

    const coldTree = new TreeClass(activeFacade, ast1, initialCode);
    console.log(
      `coldTree: type=${coldTree.rootNode.type} pad=${coldTree.rootNode._cachedPad} len=${coldTree.rootNode._cachedLen} endIdx=${coldTree.rootNode.endIndex} codeLen=${initialCode.length}`,
    );
    for (let i = 0; i < 5; i++) {
      const child = coldTree.rootNode.child(i);
      console.log(
        `  cold child[${i}]: type=${child.type} pad=${child._cachedPad} len=${child._cachedLen} start=${child.startIndex} end=${child.endIndex}`,
      );
    }

    // 2. Incremental edit at Equation 0 (Head of list)
    const targetEq0 = "eq x_0 = 0.0;";
    const replEq0 = "eq x_0 = 999.0;";
    const offset0 = initialCode.indexOf(targetEq0);
    const codeHead = initialCode.replace(targetEq0, replEq0);

    const tHead0 = performance.now();
    const astHead = activeFacade.parse(
      codeHead,
      offset0,
      offset0 + targetEq0.length,
      offset0 + replEq0.length,
      undefined,
      ast1,
    );
    const tHead = performance.now() - tHead0;
    expect(astHead).toBeGreaterThan(0);
    console.log(`[LongListDSL N=${N}] Incremental Head Edit (eq 0): ${tHead.toFixed(2)} ms`);

    // 2b. Incremental edit at Equation 2500 (Middle of list)
    const midIdx = Math.floor(N / 2);
    const targetMid = `eq x_${midIdx} = ${midIdx}.0;`;
    const replMid = `eq x_${midIdx} = 777.0;`;
    const offsetMid = initialCode.indexOf(targetMid);
    const codeMid = initialCode.replace(targetMid, replMid);

    const tMid0 = performance.now();
    const astMid = activeFacade.parse(
      codeMid,
      offsetMid,
      offsetMid + targetMid.length,
      offsetMid + replMid.length,
      undefined,
      ast1,
    );
    const tMid = performance.now() - tMid0;
    expect(astMid).toBeGreaterThan(0);
    console.log(`[LongListDSL N=${N}] Incremental Middle Edit (eq ${midIdx}): ${tMid.toFixed(2)} ms`);

    // 3. Incremental edit at Equation N-1 (Tail of list)
    const targetTail = `eq x_${N - 1} = ${N - 1}.0;`;
    const replTail = `eq x_${N - 1} = 888.0;`;
    const offsetTail = initialCode.indexOf(targetTail);
    const codeTail = initialCode.replace(targetTail, replTail);

    const tTail0 = performance.now();
    const astTail = activeFacade.parse(
      codeTail,
      offsetTail,
      offsetTail + targetTail.length,
      offsetTail + replTail.length,
      undefined,
      ast1,
    );
    const tTail = performance.now() - tTail0;
    expect(astTail).toBeGreaterThan(0);
    console.log(`[LongListDSL N=${N}] Incremental Tail Edit (eq ${N - 1}): ${tTail.toFixed(2)} ms`);

    const treeHead = new TreeClass(activeFacade, astHead, codeHead);
    expect(treeHead.rootNode.endIndex).toBe(codeHead.length);

    const treeMid = new TreeClass(activeFacade, astMid, codeMid);
    expect(treeMid.rootNode.endIndex).toBe(codeMid.length);

    const treeTail = new TreeClass(activeFacade, astTail, codeTail);
    expect(treeTail.rootNode.endIndex).toBe(codeTail.length);
  }, 60000);
});
