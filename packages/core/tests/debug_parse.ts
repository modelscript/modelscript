import { createWasmParser } from "@modelscript/language";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.resolve(__dirname, "../../../languages/sysml2/dist/parser.wasm");
const { parser } = await createWasmParser(wasmPath);

interface TreeNode {
  type: string;
  startIndex: number;
  endIndex: number;
  text: string;
  children: TreeNode[];
}

function testSnippet(title: string, source: string) {
  console.log(`\n=== Testing: ${title} ===`);
  console.log(`Source:\n${source}`);
  const tree = parser.parse(source);
  function printTree(node: TreeNode, indent = "") {
    console.log(
      `${indent}${node.type} [${node.startIndex}..${node.endIndex}]: ${JSON.stringify(node.text.slice(0, 30))}`,
    );
    for (const child of node.children) {
      printTree(child, indent + "  ");
    }
  }
  printTree(tree.rootNode as unknown as TreeNode);
}

testSnippet("1. doc comment", `doc /* Maximum speed limit */`);
testSnippet("2. require constraint", `require constraint { 10.0 <= maxLimit }`);
testSnippet("3. requirement req1", `requirement req1 : ReqDef { attribute redefine maxLimit = 5.0; }`);
testSnippet("4. attribute redefine", `attribute redefine maxLimit = 5.0;`);
testSnippet(
  "5. requirement def ReqDef",
  `requirement def ReqDef {
  attribute maxLimit : Real = 8.0;
  doc /* Maximum speed limit */
}`,
);
testSnippet(
  "6. full source",
  `package TestPackage {
  requirement def ReqDef {
    attribute maxLimit : Real = 8.0;
    doc /* Maximum speed limit */
    
    require constraint {
      10.0 <= maxLimit
    }
  }
  
  requirement req1 : ReqDef {
    attribute redefine maxLimit = 5.0;
  }
}`,
);
