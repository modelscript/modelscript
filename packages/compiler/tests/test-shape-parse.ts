import Modelica from "@modelscript/modelica/parser";
import Parser from "tree-sitter";

const parser = new Parser();
parser.setLanguage(Modelica);

const source = `
shape Box "Axis-aligned box centered at origin"
  parameter Real width = 1 "Full extent along X";
  parameter Real height = 1 "Full extent along Y";
  parameter Real depth = 1 "Full extent along Z";
end Box;
`;

const tree = parser.parse(source);
const root = tree.rootNode;

console.log("=== Parse Tree ===");
console.log(root.toString());

// Check for errors
const errors: string[] = [];
function findErrors(node: Parser.SyntaxNode) {
  if (node.type === "ERROR" || node.isMissing) {
    errors.push(`${node.type} at ${node.startPosition.row}:${node.startPosition.column}`);
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      findErrors(child);
    }
  }
}
findErrors(root);

if (errors.length === 0) {
  console.log("\n✅ No parse errors — 'shape' keyword is recognized!");
} else {
  console.log("\n❌ Parse errors found:");
  errors.forEach((e) => console.log(`  - ${e}`));
}

// Navigate to the ClassPrefixes node
const classDef = root.child(0);
if (classDef) {
  const prefixes = classDef.childForFieldName("classPrefixes");
  if (prefixes) {
    const shapeField = prefixes.childForFieldName("shape");
    console.log(`\nClassPrefixes text: "${prefixes.text}"`);
    console.log(`shape field present: ${shapeField != null}`);
    if (shapeField) {
      console.log(`shape field text: "${shapeField.text}"`);
    }
  }
}
