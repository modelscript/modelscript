import Modelica from "@modelscript/tree-sitter-modelica";
import Parser, { SyntaxNode } from "tree-sitter";

const parser = new Parser();
parser.setLanguage(Modelica);

const sourceCode = `
model M
equation
  a = b + c;
  d = e * f;
end M;
`;

const tree = parser.parse(sourceCode);

function getEquationSections(cstNode: SyntaxNode): SyntaxNode[] {
  const sections: SyntaxNode[] = [];
  if (cstNode.type !== "class_definition") return sections;

  const classSpecifier = cstNode.childForFieldName("classSpecifier");
  if (!classSpecifier || classSpecifier.type !== "long_class_specifier") return sections;

  const composition = classSpecifier.childForFieldName("composition");
  if (!composition) return sections;

  for (const child of composition.namedChildren) {
    if (child.type === "equation_section" || child.type === "initial_equation_section") {
      sections.push(child);
    }
  }
  return sections;
}

const firstChild = tree.rootNode.child(0);
if (!firstChild) process.exit(1);
const sections = getEquationSections(firstChild);
console.log("Found sections:", sections.length);
for (const sec of sections) {
  console.log("Section initial:", sec.type === "initial_equation_section");
  for (const eq of sec.namedChildren) {
    if (eq.type === "equation") {
      const inner = eq.firstNamedChild;
      if (inner && inner.type === "simple_equation") {
        const expr1 = inner.childForFieldName("expression1");
        const expr2 = inner.childForFieldName("expression2");
        console.log("  simple_equation:", expr1?.text, "=", expr2?.text);
      } else {
        console.log("  other equation:", inner?.type);
      }
    }
  }
}
