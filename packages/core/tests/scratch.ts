import Modelica from "@modelscript/modelica/parser";
import { ArenaDAEPrinter } from "@modelscript/symbolics";
import { StringWriter } from "@modelscript/utils";
import fs from "node:fs";
import Parser from "tree-sitter";
import { Context } from "../src/compiler/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

const context = new Context(new NodeFileSystem());
const source = fs.readFileSync("testsuite/OpenModelica/flattening/modelica/types/TypeDeclArray.mo", "utf-8");
context.load(source, "TypeDeclArray.mo");

console.log("Flattening TypeDeclArray...");
const arena = context.flattenArena("TypeDeclArray");
if (arena) {
  const out = new StringWriter();
  const printer = new ArenaDAEPrinter(out, arena);
  printer.printDAE(arena);
  console.log("Flattened Result:");
  console.log(out.toString());
  console.log("Diagnostics:", arena.diagnostics);
} else {
  console.log("Flatten returned null!");
}
