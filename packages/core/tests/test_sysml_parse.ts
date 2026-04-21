import SysML from "@modelscript/tree-sitter-sysml2";
import Parser from "tree-sitter";

const parser = new Parser();
parser.setLanguage(SysML);

const tree = parser.parse("constraint max_v { circuit.v <= req.maxLimit }");
console.log(tree.rootNode.toString());
