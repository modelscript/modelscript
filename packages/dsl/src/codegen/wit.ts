import { LanguageOptions } from "../dsl/language.js";

export function generateWit(grammarDef: LanguageOptions, normalized?: any): string {
  const packageName = grammarDef.targets?.wit?.package || `modelscript:${grammarDef.name || "parser"}`;
  const worldName = grammarDef.targets?.wit?.world || "language-runner";

  let code = `// Wasm Interface Type (WIT) IDL for ${packageName}\n`;
  code += `package ${packageName};\n\n`;
  code += `world ${worldName} {\n`;
  code += `  export parse: func(source: string) -> u32;\n`;
  code += `  export get-node-first-child: func(node: u32) -> u32;\n`;
  code += `  export get-node-next-sibling: func(node: u32) -> u32;\n`;
  code += `  export get-node-type: func(node: u32) -> u32;\n`;
  code += `  export get-node-start: func(node: u32) -> u32;\n`;
  code += `  export get-node-end: func(node: u32) -> u32;\n`;
  code += `  export emit-ast: func(root-instance: u32) -> u32;\n`;
  code += `  export clone-node-shadowed: func(ast-ptr: u32, instance-ctx: u32) -> u32;\n`;

  if (grammarDef.model) {
    for (const [modelName, fields] of Object.entries(grammarDef.model)) {
      if (!fields) continue;
      const modelFields = fields as Record<string, any>;
      for (const fieldName of Object.keys(modelFields)) {
        const kebabModelName = modelName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
        const kebabFieldName = fieldName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
        code += `  export get-${kebabModelName}-${kebabFieldName}: func(node: u32) -> u32;\n`;
      }
    }
  }

  code += `}\n`;
  return code;
}
