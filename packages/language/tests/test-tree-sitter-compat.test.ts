import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, optional, prec, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compatGrammar = language({
  name: "TreeSitterCompatDSL",
  word: ($) => $.Identifier,
  rules: {
    Program: ($) => repeat($.ModelDef),
    ModelDef: ($) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat(choice($.Decl, $.Equation)),
        semanticToken("keyword", "end"),
        field("endName", $.Identifier),
        ";",
      ),
    Decl: ($) =>
      seq(
        field("type", $.Type),
        field("name", $.Identifier),
        repeat(seq(",", field("name", $.Identifier))),
        optional(seq("=", field("value", $.Expr))),
        ";",
      ),
    Type: ($) => choice($.Identifier, "Real", "Integer"),
    Equation: ($) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
    Expr: ($) => choice($.MulExpr, $.AddExpr, $.Identifier, $.Number),
    MulExpr: ($) => prec.left(2, seq(field("left", $.Expr), field("op", "*"), field("right", $.Expr))),
    AddExpr: ($) => prec.left(1, seq(field("left", $.Expr), field("op", choice("+", "-")), field("right", $.Expr))),
    Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: ($) => [/\s/],
});

describe("100% Tree-sitter API Compatibility Suite", () => {
  let activeFacade: any;
  let TreeClass: any;
  let TreeCursorClass: any;
  let SyntaxNodeClass: any;
  let TreeSitterParserClass: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(compatGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_tree_sitter_compat");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export /g, "") +
      `\nreturn { LspFacade, Tree, TreeCursor, SyntaxNode, TreeSitterParser };`;
    const getExports = new Function(wrapperSrc);
    const exportsObj = getExports();
    const { LspFacade, Tree, TreeCursor, SyntaxNode, TreeSitterParser } = exportsObj;
    TreeClass = Tree;
    TreeCursorClass = TreeCursor;
    SyntaxNodeClass = SyntaxNode;
    TreeSitterParserClass = TreeSitterParser;

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: { memory, abort: () => {}, logNode: () => {}, debugLog: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
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

  function parseToTree(code: string) {
    activeFacade.lastAstRoot = 0;
    const astRoot = activeFacade.parse(code);
    return new TreeClass(activeFacade, astRoot, code);
  }

  it("should provide full SyntaxNode properties and navigation matching Tree-sitter", () => {
    const code = `model Circuit\n  Real voltage = 12.0;\nend Circuit;\n`;
    const tree = parseToTree(code);
    const root = tree.rootNode;

    expect(root).toBeDefined();
    expect(root.type).toBe("Program");
    expect(root.isNamed()).toBe(true);
    expect(root.hasError()).toBe(false);
    expect(root.childCount).toBe(1);
    expect(root.namedChildCount).toBe(1);

    const modelDef = root.firstChild;
    expect(modelDef).toBeDefined();
    expect(modelDef.type).toBe("ModelDef");
    expect(modelDef.isNamed()).toBe(true);
    expect(modelDef.parent.equals(root)).toBe(true);

    // Named children vs all children
    expect(modelDef.namedChildren.length).toBeGreaterThan(0);
    const firstNamed = modelDef.firstNamedChild;
    expect(firstNamed).toBeDefined();
    expect(firstNamed.type).toBe("Identifier");
    expect(firstNamed.text).toBe("Circuit");

    // Sibling navigation
    const decl = modelDef.namedChildren.find((c: any) => c.type === "Decl");
    expect(decl).toBeDefined();
    expect(decl.type).toBe("Decl");
    expect(decl.parent.equals(modelDef)).toBe(true);
  });

  it("should penetrate optional combinators in childForFieldName queries", () => {
    const code = `model M\n  Real v = 10.0;\n  Real uninit;\nend M;\n`;
    const tree = parseToTree(code);
    const root = tree.rootNode;
    const modelDef = root.firstChild;
    const decls = modelDef.namedChildren.filter((c: any) => c.type === "Decl");

    expect(decls.length).toBe(2);

    // Initialized Decl (has optional value)
    const initDecl = decls[0];
    const typeNode = initDecl.childForFieldName("type");
    expect(typeNode).toBeDefined();
    expect(typeNode.text).toBe("Real");

    const nameNode = initDecl.childForFieldName("name");
    expect(nameNode).toBeDefined();
    expect(nameNode.text).toBe("v");

    // childForFieldName on optional expression value
    const valNode = initDecl.childForFieldName("value");
    expect(valNode).toBeDefined();
    expect(valNode.text).toBe("10.0");

    // Uninitialized Decl (optional value is absent)
    const uninitDecl = decls[1];
    const uninitVal = uninitDecl.childForFieldName("value");
    expect(uninitVal).toBeNull();
  });

  it("should resolve binary expression fields (left, op, right)", () => {
    const code = `model M\n  x = y + 5.0;\nend M;\n`;
    const tree = parseToTree(code);
    const root = tree.rootNode;
    const modelDef = root.firstChild;
    const eqNode = modelDef.namedChildren.find((c: any) => c.type === "Equation");
    expect(eqNode).toBeDefined();

    const lhs = eqNode.childForFieldName("lhs");
    expect(lhs).toBeDefined();
    expect(lhs.text).toBe("x");

    const rhs = eqNode.childForFieldName("rhs");
    expect(rhs).toBeDefined();
    const addExpr = rhs.type === "AddExpr" ? rhs : rhs.firstChild;
    expect(addExpr.type).toBe("AddExpr");

    const addLeft = addExpr.childForFieldName("left");
    expect(addLeft).toBeDefined();
    expect(addLeft.text).toBe("y");

    const addRight = addExpr.childForFieldName("right");
    expect(addRight).toBeDefined();
    expect(addRight.text).toBe("5.0");
  });

  it("should support descendant search and closest ancestor queries", () => {
    const code = `model Circuit\n  Real voltage = 12.0;\nend Circuit;\n`;
    const tree = parseToTree(code);
    const root = tree.rootNode;

    // Find descendant covering 'voltage' (indices 21..28)
    const voltNode = root.namedDescendantForIndex(21, 28);
    expect(voltNode).toBeDefined();
    expect(voltNode.text).toBe("voltage");
    expect(voltNode.type).toBe("Identifier");

    // Closest query
    const parentDecl = voltNode.closest(["Decl", "Program"]);
    expect(parentDecl).toBeDefined();
    expect(parentDecl.type).toBe("Decl");

    const parentModel = voltNode.closest("ModelDef");
    expect(parentModel).toBeDefined();
    expect(parentModel.type).toBe("ModelDef");

    // descendantsOfType
    const allIdentifiers = root.descendantsOfType("Identifier");
    expect(allIdentifiers.length).toBeGreaterThanOrEqual(3);
    const names = allIdentifiers.map((n: any) => n.text);
    expect(names).toContain("Circuit");
    expect(names).toContain("voltage");
  });

  it("should generate S-expression via toString()", () => {
    const code = `model Simple\nend Simple;\n`;
    const tree = parseToTree(code);
    const sexpr = tree.rootNode.toString();

    expect(sexpr).toContain("Program");
    expect(sexpr).toContain("ModelDef");
    expect(sexpr).toContain("Identifier");
    expect(sexpr).toContain("Simple");
  });

  it("should support stateful cursor traversal with TreeCursor", () => {
    const code = `model Circuit\n  Real v;\nend Circuit;\n`;
    const tree = parseToTree(code);
    const cursor = tree.walk();

    expect(cursor.nodeType).toBe("Program");
    expect(cursor.nodeIsNamed).toBe(true);

    // gotoFirstChild into ModelDef
    expect(cursor.gotoFirstChild()).toBe(true);
    expect(cursor.nodeType).toBe("ModelDef");

    // gotoFirstChild into keyword 'model' or first child
    expect(cursor.gotoFirstChild()).toBe(true);
    expect(cursor.currentNode).toBeDefined();

    // gotoNextSibling into Identifier
    expect(cursor.gotoNextSibling()).toBe(true);
    expect(cursor.nodeText).toBe("Circuit");

    // gotoParent back to ModelDef
    expect(cursor.gotoParent()).toBe(true);
    expect(cursor.nodeType).toBe("ModelDef");
  });

  it("should work through TreeSitterParser facade", () => {
    const parser = new TreeSitterParserClass();
    parser.setLanguage(() => activeFacade);

    const code = `model P\nend P;\n`;
    const tree = parser.parse(code);
    expect(tree).toBeDefined();
    expect(tree.rootNode.type).toBe("Program");
  });
});
