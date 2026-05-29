import Modelica from "@modelscript/modelica/parser";
import Parser from "tree-sitter";

const parser = new Parser();
parser.setLanguage(Modelica);

const source = `
package Modelica
  extends Package;
  annotation (Icon(graphics={Ellipse()}));
end Modelica;
`;

const tree = parser.parse(source);
console.log(tree.rootNode.toString());
