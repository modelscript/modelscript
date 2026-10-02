// SPDX-License-Identifier: AGPL-3.0-or-later

export class JsEmitter {
  private indentLevel = 0;
  private varCounter = 0;

  private indent(): string {
    return "  ".repeat(this.indentLevel);
  }

  emit(node: any): string {
    if (!node) return "";

    switch (node.type) {
      case "SourceFile": {
        const statements: string[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child.type !== ";" && child.type !== "_EmptyStatement") {
            const code = this.emit(child);
            if (code.trim()) statements.push(code);
          }
        }
        return statements.join("\n");
      }

      case "TopLevelDeclaration":
      case "Statement":
      case "Expression":
      case "PrimaryExpression": {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child.type !== ";" && child.type !== "_EmptyStatement") {
            return this.emit(child);
          }
        }
        return "";
      }

      case "ImportDeclaration": {
        const specifiersNode = node.childForFieldName?.("specifiers");
        const sourceNode = node.childForFieldName?.("source");
        const specifiersText = specifiersNode ? this.emit(specifiersNode) : "";
        const sourceText = sourceNode ? sourceNode.text : '""';
        return `// polyglot import: ${specifiersText} from ${sourceText};\n`;
      }

      case "ImportSpecifierList": {
        const specs: string[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (c.type === "ImportSpecifier") {
            specs.push(this.emit(c));
          }
        }
        return `{ ${specs.join(", ")} }`;
      }

      case "ImportSpecifier": {
        const imported = node.childForFieldName?.("imported")?.text;
        const local = node.childForFieldName?.("local")?.text;
        const name = node.childForFieldName?.("name")?.text;
        if (imported && local) return `${imported} as ${local}`;
        return name || node.text;
      }

      case "StructDeclaration": {
        const name = node.childForFieldName?.("name")?.text || "AnonymousStruct";
        const fields: string[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child.type === "StructField") {
            const fName = child.childForFieldName?.("name")?.text;
            if (fName) fields.push(fName);
          }
        }
        return `class ${name} {\n${this.indent()}  constructor(${fields.join(", ")}) {\n${fields
          .map((f) => `${this.indent()}    this.${f} = ${f};`)
          .join("\n")}\n${this.indent()}  }\n${this.indent()}}`;
      }

      case "FunctionDeclaration": {
        const name = node.childForFieldName?.("name")?.text || "fn";
        const paramsNode = node.childForFieldName?.("parameters");
        const paramsText = paramsNode ? this.emit(paramsNode) : "";
        const bodyNode = node.childForFieldName?.("body");
        const bodyText = bodyNode ? this.emit(bodyNode) : "{}";
        return `function ${name}(${paramsText}) ${bodyText}`;
      }

      case "ParameterList": {
        const params: string[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (c.type === "Parameter") {
            params.push(this.emit(c));
          }
        }
        return params.join(", ");
      }

      case "Parameter": {
        return node.childForFieldName?.("name")?.text || "";
      }

      case "BlockStatement": {
        this.indentLevel++;
        const stmts: string[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child.type !== "{" && child.type !== "}") {
            const s = this.emit(child);
            if (s.trim()) stmts.push(`${this.indent()}${s}`);
          }
        }
        this.indentLevel--;
        return `{\n${stmts.join("\n")}\n${this.indent()}}`;
      }

      case "VariableDeclaration": {
        const name = node.childForFieldName?.("name")?.text || "";
        const valNode = node.childForFieldName?.("value");
        if (valNode) {
          return `let ${name} = ${this.emit(valNode)};`;
        }
        return `let ${name};`;
      }

      case "AssignmentStatement": {
        const targetNode = node.childForFieldName?.("target");
        const op = node.childForFieldName?.("operator")?.text || "=";
        const valNode = node.childForFieldName?.("value");
        return `${this.emit(targetNode)} ${op} ${this.emit(valNode)};`;
      }

      case "ReturnStatement": {
        const valNode = node.childForFieldName?.("value");
        if (valNode) {
          return `return ${this.emit(valNode)};`;
        }
        return `return;`;
      }

      case "IfStatement": {
        const condNode = node.childForFieldName?.("condition");
        const consNode = node.childForFieldName?.("consequence");
        const altNode = node.childForFieldName?.("alternative");
        let res = `if (${this.emit(condNode)}) ${this.emit(consNode)}`;
        if (altNode) {
          res += ` else ${this.emit(altNode)}`;
        }
        return res;
      }

      case "WhileStatement": {
        const condNode = node.childForFieldName?.("condition");
        const bodyNode = node.childForFieldName?.("body");
        return `while (${this.emit(condNode)}) ${this.emit(bodyNode)}`;
      }

      case "ForStatement": {
        const initNode = node.childForFieldName?.("init");
        const condNode = node.childForFieldName?.("condition");
        const updateNode = node.childForFieldName?.("update");
        const bodyNode = node.childForFieldName?.("body");
        const initStr = initNode ? this.emit(initNode).replace(/;$/, "") : "";
        const condStr = condNode ? this.emit(condNode) : "";
        const updateStr = updateNode ? this.emit(updateNode) : "";
        return `for (${initStr}; ${condStr}; ${updateStr}) ${this.emit(bodyNode)}`;
      }

      case "ExpressionStatement": {
        const exprNode = node.childForFieldName?.("expression");
        return `${this.emit(exprNode)};`;
      }

      case "FLWORExpression": {
        return this.emitFLWOR(node);
      }

      case "BinaryExpression": {
        const leftNode = node.childForFieldName?.("left");
        const opNode = node.childForFieldName?.("operator");
        const rightNode = node.childForFieldName?.("right");
        return `(${this.emit(leftNode)} ${opNode?.text || "+"} ${this.emit(rightNode)})`;
      }

      case "UnaryExpression": {
        const opNode = node.childForFieldName?.("operator");
        const operandNode = node.childForFieldName?.("operand");
        return `${opNode?.text || "!"}(${this.emit(operandNode)})`;
      }

      case "NewExpression": {
        const ctor = node.childForFieldName?.("constructor")?.text;
        const argsNode = node.childForFieldName?.("arguments");
        const argsText = argsNode ? this.emit(argsNode) : "";
        return `new ${ctor}(${argsText})`;
      }

      case "PostfixExpression": {
        const objNode = node.childForFieldName?.("object");
        const propNode = node.childForFieldName?.("property");
        if (objNode && propNode) {
          return `${this.emit(objNode)}.${propNode.text}`;
        }
        const calleeNode = node.childForFieldName?.("callee");
        if (calleeNode) {
          const argsNode = node.childForFieldName?.("arguments");
          const argsText = argsNode ? this.emit(argsNode) : "";
          return `${this.emit(calleeNode)}(${argsText})`;
        }
        const arrNode = node.childForFieldName?.("array");
        const idxNode = node.childForFieldName?.("index");
        if (arrNode && idxNode) {
          return `${this.emit(arrNode)}[${this.emit(idxNode)}]`;
        }
        return node.text;
      }

      case "ArgumentList": {
        const args: string[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (c.type === "Argument") {
            args.push(this.emit(c));
          }
        }
        return args.join(", ");
      }

      case "Argument": {
        const val = node.childForFieldName?.("value");
        return val ? this.emit(val) : node.text;
      }

      case "ArrayLiteral": {
        const elems: string[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (c.type === "Expression") {
            elems.push(this.emit(c));
          }
        }
        return `[${elems.join(", ")}]`;
      }

      case "ObjectLiteral": {
        const fields: string[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (c.type === "ObjectField") {
            const key = c.childForFieldName?.("key")?.text;
            const val = c.childForFieldName?.("value");
            const shorthand = c.childForFieldName?.("shorthand")?.text;
            if (key && val) {
              fields.push(`${key}: ${this.emit(val)}`);
            } else if (shorthand) {
              fields.push(shorthand);
            }
          }
        }
        return `{ ${fields.join(", ")} }`;
      }

      case "ParenthesizedExpression": {
        const expr = node.childForFieldName?.("expression");
        return `(${this.emit(expr)})`;
      }

      case "IDENTIFIER":
      case "NUMBER":
      case "STRING":
      case "BOOLEAN": {
        return node.text;
      }

      default:
        return node.text || "";
    }
  }

  private emitFLWOR(node: any): string {
    const forClauses: any[] = [];
    const letClauses: any[] = [];
    let whereClause: any = null;
    let orderByClause: any = null;
    let returnClause: any = null;

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === "ForClause") forClauses.push(child);
      else if (child.type === "LetClause") letClauses.push(child);
      else if (child.type === "WhereClause") whereClause = child;
      else if (child.type === "OrderByClause") orderByClause = child;
      else if (child.type === "ReturnClause") returnClause = child;
    }

    const resVar = `__res_${this.varCounter++}`;
    let code = "(() => {\n";
    code += `  const ${resVar} = [];\n`;

    // Nest for loops
    let loopsOpen = 0;
    for (const fc of forClauses) {
      const v = fc.childForFieldName?.("variable")?.text;
      const coll = this.emit(fc.childForFieldName?.("collection"));
      code += `  for (const ${v} of (${coll} || [])) {\n`;
      loopsOpen++;
    }

    // Let bindings
    for (const lc of letClauses) {
      const v = lc.childForFieldName?.("variable")?.text;
      const val = this.emit(lc.childForFieldName?.("value"));
      code += `    const ${v} = ${val};\n`;
    }

    // Where condition
    let whereOpen = false;
    if (whereClause) {
      const cond = this.emit(whereClause.childForFieldName?.("condition"));
      code += `    if (${cond}) {\n`;
      whereOpen = true;
    }

    // Order by or direct return
    const returnVal = this.emit(returnClause?.childForFieldName?.("value"));
    if (orderByClause) {
      const crit = this.emit(orderByClause.childForFieldName?.("criteria"));
      const dir = orderByClause.childForFieldName?.("direction")?.text || "asc";
      const isDesc = dir.startsWith("desc");
      code += `      ${resVar}.push({ __criteria: ${crit}, __val: ${returnVal} });\n`;
    } else {
      code += `      ${resVar}.push(${returnVal});\n`;
    }

    if (whereOpen) {
      code += `    }\n`;
    }

    while (loopsOpen > 0) {
      code += `  }\n`;
      loopsOpen--;
    }

    if (orderByClause) {
      const dir = orderByClause.childForFieldName?.("direction")?.text || "asc";
      const isDesc = dir.startsWith("desc");
      if (isDesc) {
        code += `  ${resVar}.sort((a, b) => (b.__criteria > a.__criteria ? 1 : b.__criteria < a.__criteria ? -1 : 0));\n`;
      } else {
        code += `  ${resVar}.sort((a, b) => (a.__criteria > b.__criteria ? 1 : a.__criteria < b.__criteria ? -1 : 0));\n`;
      }
      code += `  return ${resVar}.map(i => i.__val);\n`;
    } else {
      code += `  return ${resVar};\n`;
    }

    code += `})()`;
    return code;
  }
}
