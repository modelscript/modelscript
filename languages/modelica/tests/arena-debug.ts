import Modelica from "@modelscript/modelica/parser";
import Parser, { SyntaxNode } from "tree-sitter";
import { Context } from "../src/compiler/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

const src = `model Simple
  Real x(start = 1.0);
equation
  der(x) = -x;
end Simple;`;

console.log("Source bytes 30-33:", JSON.stringify(src.substring(30, 33)));
console.log("Full src length:", src.length);

const ctx = new Context(new NodeFileSystem());
ctx.load(src);

const qe = ctx.queryEngine;
const queryDB = qe.toQueryDB();

// Check cstNodeRange
const node = queryDB.cstNodeRange(30, 33, undefined);
console.log(
  "cstNodeRange(30, 33):",
  node ? `type=${(node as SyntaxNode).type}, text=${(node as SyntaxNode).text}` : "null",
);

// Try broader range
const node2 = queryDB.cstNodeRange(29, 33, undefined);
console.log(
  "cstNodeRange(29, 33):",
  node2 ? `type=${(node2 as SyntaxNode).type}, text=${(node2 as SyntaxNode).text}` : "null",
);

// Direct parse for reference
const tree = parser.parse(src);
const root = tree.rootNode;
const desc = root.descendantForIndex(30, 33);
console.log("tree-sitter descendant(30,33):", desc ? `type=${desc.type}, text=${desc.text}` : "null");
