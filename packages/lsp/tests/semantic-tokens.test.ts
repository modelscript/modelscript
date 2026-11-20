// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import assert from "node:assert";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { legend, registerSemanticTokensProvider } from "../src/providers/semanticTokensProvider.js";
import { registerBuiltinLanguagePlugins } from "../src/registry/builtin-plugins.js";

test("LSP Semantic Tokens Test Suite", async (t) => {
  registerBuiltinLanguagePlugins({
    workspaceManager: {
      getWorkspaceIndex: () => ({}),
      setWorkspaceIndex: () => {},
      unifiedWorkspace: { registerWorkspace: () => {} },
    },
    parserService: {},
    connection: { console: { info() {}, log() {}, warn() {}, error() {} } },
  } as any);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const wasmPath = path.resolve(repoRoot, "languages/modelica/dist/parser.wasm");
  const { parser } = await createWasmParser(wasmPath);

  const modelicaSource = `model SimplePendulum "A pendulum"
  parameter Real L = 1.0 "Length";
  Real theta(start = 0.1);
  Real omega;
equation
  der(theta) = omega;
end SimplePendulum;`;

  const docUri = "file:///models/SimplePendulum.mo";
  const document = TextDocument.create(docUri, "modelica", 1, modelicaSource);

  const handlers = new Map<string, (params: any) => any>();
  const mockConn: any = {
    onRequest: (method: string, handler: (params: any) => any) => {
      handlers.set(method, handler);
    },
  };

  const mockDocs: any = {
    get: (uri: string) => (uri === docUri ? document : null),
    onDidClose: () => {},
  };

  await t.test("Generates semantic tokens when getDocumentTree returns raw Tree instance", () => {
    const tree = parser.parse(modelicaSource);

    // Simulate parserService.getDocumentTree returning tree directly
    registerSemanticTokensProvider(
      mockConn,
      mockDocs,
      () => tree,
      () => null,
      () => false,
      () => null,
    );

    const fullHandler = handlers.get("textDocument/semanticTokens/full")!;
    assert.ok(fullHandler, "Semantic tokens full handler should be registered");

    const response = fullHandler({ textDocument: { uri: docUri } });
    assert.ok(response && Array.isArray(response.data), "Response must contain data array");
    assert.ok(response.data.length > 0, "Semantic tokens data must not be empty");

    // LSP semantic tokens are encoded as tuples of 5 unsigned integers:
    // [deltaLine, deltaStartChar, length, tokenTypeIndex, tokenModifierBitmask]
    assert.strictEqual(response.data.length % 5, 0, "Data length must be a multiple of 5");

    const tokens: { line: number; char: number; length: number; type: string; modifier: number }[] = [];
    let currentLine = 0;
    let currentChar = 0;

    for (let i = 0; i < response.data.length; i += 5) {
      const deltaLine = response.data[i];
      const deltaStartChar = response.data[i + 1];
      const length = response.data[i + 2];
      const tokenTypeIndex = response.data[i + 3];
      const modifier = response.data[i + 4];

      currentLine += deltaLine;
      currentChar = deltaLine > 0 ? deltaStartChar : currentChar + deltaStartChar;

      tokens.push({
        line: currentLine,
        char: currentChar,
        length,
        type: legend.tokenTypes[tokenTypeIndex],
        modifier,
      });
    }

    // Verify token ordering: strictly increasing line, or same line strictly increasing char without overlap
    for (let i = 1; i < tokens.length; i++) {
      const prev = tokens[i - 1];
      const curr = tokens[i];
      if (curr.line === prev.line) {
        assert.ok(
          curr.char >= prev.char + prev.length,
          `Tokens on same line must not overlap: prev=${JSON.stringify(prev)}, curr=${JSON.stringify(curr)}`,
        );
      } else {
        assert.ok(curr.line > prev.line, "Lines must be monotonically increasing");
      }
    }

    // Verify specific key tokens were classified properly
    // Line 0: "SimplePendulum" at col 6 -> class
    const classToken = tokens.find((tok) => tok.line === 0 && tok.char === 6);
    assert.ok(classToken, "SimplePendulum class token should be found");
    assert.strictEqual(classToken.type, "class");
    assert.strictEqual(classToken.modifier, 1, "Class declaration should have declaration modifier");

    // Line 1: "Real" at col 12 -> type
    const realTypeToken = tokens.find((tok) => tok.line === 1 && tok.char === 12);
    assert.ok(realTypeToken, "Real type token should be found");
    assert.strictEqual(realTypeToken.type, "type");

    // Line 1: "L" at col 17 -> parameter
    const lToken = tokens.find((tok) => tok.line === 1 && tok.char === 17);
    assert.ok(lToken, "parameter L token should be found");
    assert.strictEqual(lToken.type, "parameter");
    assert.strictEqual(lToken.modifier, 1, "Parameter declaration should have declaration modifier");

    // Line 1: "1.0" at col 21 -> number
    const numToken = tokens.find((tok) => tok.line === 1 && tok.char === 21);
    assert.ok(numToken, "Number literal token should be found");
    assert.strictEqual(numToken.type, "number");

    // Line 1: string at col 25 -> string
    const strToken = tokens.find((tok) => tok.line === 1 && tok.char === 25);
    assert.ok(strToken, "String literal token should be found");
    assert.strictEqual(strToken.type, "string");
  });

  await t.test("Generates semantic tokens when getDocumentTree returns wrapped { tree, text }", () => {
    const tree = parser.parse(modelicaSource);

    registerSemanticTokensProvider(
      mockConn,
      mockDocs,
      () => ({ tree, text: modelicaSource }),
      () => null,
      () => false,
      () => null,
    );

    const fullHandler = handlers.get("textDocument/semanticTokens/full")!;
    const response = fullHandler({ textDocument: { uri: docUri } });
    assert.ok(response && Array.isArray(response.data));
    assert.ok(response.data.length > 0, "Semantic tokens should be generated with tree wrapper");
  });

  await t.test("Falls back to parseFallback if tree is missing or stale", () => {
    let fallbackCalled = false;
    let receivedExt = "";

    registerSemanticTokensProvider(
      mockConn,
      mockDocs,
      () => null, // no cached tree
      () => null,
      () => false,
      (ext, text) => {
        fallbackCalled = true;
        receivedExt = ext;
        return parser.parse(text);
      },
    );

    const fullHandler = handlers.get("textDocument/semanticTokens/full")!;
    const response = fullHandler({ textDocument: { uri: docUri } });
    assert.ok(fallbackCalled, "parseFallback should be called when cached tree is null");
    assert.strictEqual(receivedExt, ".mo");
    assert.ok(response && response.data.length > 0, "Tokens should be returned from fallback parse");
  });

  await t.test("Passes actual URI extension to parseFallback and consumes WASM getSemanticTokens()", () => {
    let receivedExt = "";
    const spiceUri = "file:///circuit.cir";
    const spiceDoc = TextDocument.create(spiceUri, "spice", 1, "R1 1 0 1k\n");
    const docsWithSpice = {
      get: (uri: string) => (uri === spiceUri ? spiceDoc : mockDocs.get(uri)),
      onDidClose: () => {},
    } as any;

    const fakeWasmTree = {
      rootNode: { getPtr: () => 1 },
      getSemanticTokens: () => new Uint32Array([0, 0, 2, 3, 1]),
    };

    registerSemanticTokensProvider(
      mockConn,
      docsWithSpice,
      () => null,
      () => null,
      () => false,
      (ext) => {
        receivedExt = ext;
        return fakeWasmTree;
      },
    );

    const fullHandler = handlers.get("textDocument/semanticTokens/full")!;
    const response = fullHandler({ textDocument: { uri: spiceUri } });
    assert.strictEqual(receivedExt, ".cir", "parseFallback should receive .cir instead of .mo");
    assert.deepStrictEqual(response.data, [0, 0, 2, 3, 1], "Should emit WASM semantic tokens directly");
  });

  function decodeTokens(data: number[], text: string) {
    const lines = text.split(/\r?\n/);
    const out: { line: number; char: number; length: number; type: string; modifiers: number; text: string }[] = [];
    let line = 0;
    let char = 0;
    for (let i = 0; i + 4 < data.length; i += 5) {
      const dLine = data[i]!;
      const dChar = data[i + 1]!;
      const length = data[i + 2]!;
      const type = legend.tokenTypes[data[i + 3]!] ?? "unknown";
      const modifiers = data[i + 4]!;
      line += dLine;
      char = dLine === 0 ? char + dChar : dChar;
      out.push({
        line,
        char,
        length,
        type,
        modifiers,
        text: (lines[line] ?? "").slice(char, char + length),
      });
    }
    return out;
  }

  function createTestProvider(
    parseFallback: (ext: string, text: string) => any,
    getDocumentTree?: (uri: string) => any,
  ) {
    const handlers = new Map<string, any>();
    const docsMap = new Map<string, TextDocument>();
    const mockConnection: any = {
      onRequest(method: string, handler: any) {
        handlers.set(method, handler);
      },
    };
    const mockDocuments: any = {
      get: (uri: string) => docsMap.get(uri),
      onDidClose: () => {},
    };
    registerSemanticTokensProvider(
      mockConnection,
      mockDocuments,
      getDocumentTree ?? (() => null),
      () => null,
      () => false,
      parseFallback,
    );
    const fullHandler = handlers.get("textDocument/semanticTokens/full")!;
    return {
      run(uri: string, languageId: string, code: string) {
        const doc = TextDocument.create(uri, languageId, 1, code);
        docsMap.set(uri, doc);
        const res = fullHandler({ textDocument: { uri } });
        return decodeTokens(res.data, code);
      },
    };
  }

  const req = createRequire(import.meta.url);

  await t.test("STEP (.step) uses CST nodes + inter-leaf gap comments (not inside strings)", async () => {
    const { parser } = await createWasmParser(req.resolve("@modelscript/step/parser.wasm"));
    const provider = createTestProvider((_ext, txt) => parser.parse(txt));
    const code = `ISO-10303-21;
/* Step block comment */
HEADER;
ENDSEC;
DATA;
#10=CARTESIAN_POINT('/* inside string */',(0.0,1.5,-2));
#20=DIRECTION('',(.TRUE.,#10));
ENDSEC;
END-ISO-10303-21;`;
    const toks = provider.run("file:///test/part.step", "step", code);
    assert.ok(toks.some((x) => x.text === "ISO-10303-21" && x.type === "keyword"));
    assert.ok(toks.some((x) => x.text === "/* Step block comment */" && x.type === "comment"));
    assert.ok(!toks.some((x) => x.text.includes("inside string") && x.type === "comment"));
    assert.ok(toks.some((x) => x.text === "'/* inside string */'" && x.type === "string"));
    assert.ok(toks.some((x) => x.text === "CARTESIAN_POINT" && x.type === "type"));
    assert.ok(toks.some((x) => x.text === "#10" && x.type === "variable"));
    assert.ok(toks.some((x) => x.text === ".TRUE." && x.type === "enumMember"));
  });

  await t.test("CFD (.cfg CST + .foam OpenFOAM dialect) emits accurate semantic tokens", async () => {
    const { parser } = await createWasmParser(req.resolve("@modelscript/cfd/parser.wasm"));
    const provider = createTestProvider((ext, txt) => (ext === ".cfg" ? parser.parse(txt) : null));
    const su2 = `% SU2 Config
SOLVER = INC_RANS
MACH_NUMBER = {{mach * 1.0}}
MARKER_EULER = ( airfoil, symmetry )`;
    const su2Toks = provider.run("file:///test/flow.cfg", "cfd", su2);
    assert.ok(su2Toks.some((x) => x.text === "% SU2 Config" && x.type === "comment"));
    assert.ok(su2Toks.some((x) => x.text === "SOLVER" && x.type === "keyword"));
    assert.ok(su2Toks.some((x) => x.text === "INC_RANS" && x.type === "type"));
    assert.ok(su2Toks.some((x) => x.text === "{{mach * 1.0}}" && x.type === "variable"));
    assert.ok(su2Toks.some((x) => x.text === "airfoil" && x.type === "parameter"));

    const foam = `FoamFile
{
    version 2.0; // header
    object boundaryField;
}`;
    const foamToks = provider.run("file:///test/boundary.foam", "cfd", foam);
    assert.ok(foamToks.some((x) => x.text === "// header" && x.type === "comment"));
    assert.ok(foamToks.some((x) => x.text === "2.0" && x.type === "number"));
  });

  await t.test("FEA (.inp CST + .bdf Nastran dialect) emits accurate semantic tokens", async () => {
    const { parser } = await createWasmParser(req.resolve("@modelscript/fea/parser.wasm"));
    const provider = createTestProvider((ext, txt) => (ext === ".inp" ? parser.parse(txt) : null));
    const inp = `** FEA Deck comment
*NODE, NSET=ALL_NODES
1, 0.0, 0.0, {{z}}
*ELEMENT, TYPE=C3D8, ELSET=EALL
1, 1, 2, 3, 4`;
    const inpToks = provider.run("file:///test/mesh.inp", "fea", inp);
    assert.ok(inpToks.some((x) => x.text === "** FEA Deck comment" && x.type === "comment"));
    assert.ok(inpToks.some((x) => x.text === "*NODE" && x.type === "keyword"));
    assert.ok(inpToks.some((x) => x.text === "NSET" && x.type === "parameter"));
    assert.ok(inpToks.some((x) => x.text === "C3D8" && x.type === "type"));
    assert.ok(inpToks.some((x) => x.text === "{{z}}" && x.type === "variable"));

    const bdf = `$ Nastran comment
GRID, 1, , 0.0, 1.0, 2.0`;
    const bdfToks = provider.run("file:///test/model.bdf", "fea", bdf);
    assert.ok(bdfToks.some((x) => x.text === "$ Nastran comment" && x.type === "comment"));
    assert.ok(bdfToks.some((x) => x.text === "2.0" && x.type === "number"));
  });

  await t.test("Fortran (.f90 + EMTDC .f) uses CST + fixed-form/inter-leaf comment gaps", async () => {
    const { parser } = await createWasmParser(req.resolve("@modelscript/fortran/parser.wasm"));
    const provider = createTestProvider((_ext, txt) => parser.parse(txt));
    const code = `! Modern comment
SUBROUTINE MY_SUB(X, Y)
  IMPLICIT NONE
  REAL(8), INTENT(IN) :: X
  REAL(8), INTENT(OUT) :: Y
  REAL(8) :: LOC
  LOC = $Pin
  Y = SQRT(X) + REAL(N) + LOC
  CALL HELPER(X, Y)
END SUBROUTINE MY_SUB`;
    const toks = provider.run("file:///test/sub.f90", "fortran", code);
    assert.ok(toks.some((x) => x.text === "! Modern comment" && x.type === "comment"));
    assert.ok(toks.some((x) => x.text === "SUBROUTINE" && x.type === "keyword"));
    assert.ok(toks.some((x) => x.text === "MY_SUB" && x.type === "function" && x.modifiers === 1));
    assert.ok(toks.some((x) => x.text === "REAL" && x.type === "type"));
    assert.ok(toks.some((x) => x.text === "$Pin" && x.type === "parameter"));
    assert.ok(toks.some((x) => x.text === "SQRT" && x.type === "function"));
    assert.ok(toks.some((x) => x.text === "LOC" && x.type === "variable"));
    assert.ok(toks.some((x) => x.line === 7 && x.text === "X" && x.type === "parameter"));
  });

  await t.test("OWL 2 (.ofn WASM CST + .owx XML CST) classifies declarations, comments, and literals", async () => {
    const { parser } = await createWasmParser(req.resolve("@modelscript/owl2/parser.wasm"));
    const provider = createTestProvider((ext, txt) => (ext === ".ofn" ? parser.parse(txt) : null));
    const ofn = `# Top comment
Prefix(:=<http://example.org/onto#>)
Ontology(<http://example.org/onto>
  Declaration(Class(:Motor))
  AnnotationAssertion(rdfs:label :Motor "Title # not comment")
  ClassAssertion(:Motor :motor1)
)`;
    const ofnToks = provider.run("file:///test/onto.ofn", "owl2", ofn);
    assert.ok(ofnToks.some((x) => x.text === "# Top comment" && x.type === "comment"));
    assert.ok(!ofnToks.some((x) => x.text.includes("# not comment") && x.type === "comment"));
    assert.ok(ofnToks.some((x) => x.text === ":Motor" && x.type === "class" && x.modifiers === 1));
    assert.ok(ofnToks.some((x) => x.text === ":motor1" && x.type === "enumMember"));

    const owx = `<!-- XML comment -->
<Ontology>
  <Declaration>
    <Class IRI="#Motor"/>
  </Declaration>
</Ontology>`;
    const owxToks = provider.run("file:///test/onto.owx", "owl2", owx);
    assert.ok(owxToks.some((x) => x.text === "<!-- XML comment -->" && x.type === "comment"));
    assert.ok(owxToks.some((x) => x.text === "Declaration" && x.type === "keyword"));
    assert.ok(owxToks.some((x) => x.text === "IRI" && x.type === "parameter"));
    assert.ok(owxToks.some((x) => x.text === '"#Motor"' && x.type === "string"));
  });

  await t.test(
    "Modelica type_prefix CST inspection ignores 'parameter'/'constant' words inside descriptions",
    async () => {
      const { parser } = await createWasmParser(req.resolve("@modelscript/modelica/parser.wasm"));
      const provider = createTestProvider((_ext, txt) => parser.parse(txt));
      const code = `model TestVariability
  constant Real c = 1;
  parameter Real p = 2;
  Real x "a parameter and constant description";
end TestVariability;`;
      const toks = provider.run("file:///test/TestVariability.mo", "modelica", code);
      assert.ok(toks.some((x) => x.text === "c" && x.type === "parameter" && x.modifiers === 3));
      assert.ok(toks.some((x) => x.text === "p" && x.type === "parameter" && x.modifiers === 1));
      assert.ok(toks.some((x) => x.text === "x" && x.type === "variable" && x.modifiers === 1));
    },
  );
});
