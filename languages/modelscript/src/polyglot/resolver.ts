// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ModelicaComponentInfo {
  name: string;
  type: string;
  value?: number;
  properties: Record<string, unknown>;
}

export interface PolyglotModel {
  name: string;
  language: "modelica" | "sysml2" | "step";
  components: ModelicaComponentInfo[];
}

/**
 * Extracts high-level component declarations from a Modelica CST root node.
 */
export function extractModelicaModel(modelicaTreeRoot: any, sourceText: string): PolyglotModel {
  const components: ModelicaComponentInfo[] = [];
  let modelName = "AnonymousModel";

  function walk(node: any) {
    if (!node) return;

    if (node.type === "class_definition" || node.type === "model_clause") {
      const idNode = node.childForFieldName?.("name") || node.childForFieldName?.("identifier");
      if (idNode) modelName = idNode.text;
    }

    if (node.type === "component_clause" || node.type === "ComponentClause") {
      const typeNode = node.childForFieldName?.("type_specifier") || node.children?.[0];
      const typeName = typeNode ? typeNode.text : "UnknownType";

      // Look for component declarations inside
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c.type === "component_declaration" || c.type === "ComponentDeclaration" || c.type === "declaration") {
          const id = c.childForFieldName?.("identifier") || c.childForFieldName?.("name");
          const name = id ? id.text : "unnamed";

          // Check for modification / binding value (e.g. = 100)
          let val: number | undefined = undefined;
          const match = c.text.match(/=\s*([0-9]+(?:\.[0-9]+)?)/);
          if (match) {
            val = parseFloat(match[1]);
          }

          components.push({
            name,
            type: typeName,
            value: val,
            properties: { rawText: c.text },
          });
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(modelicaTreeRoot);

  // If linear CST walker found components directly
  if (components.length === 0) {
    const keywords = new Set([
      "model",
      "package",
      "end",
      "equation",
      "algorithm",
      "initial",
      "annotation",
      "record",
      "block",
      "connector",
    ]);
    const declMatches = sourceText.matchAll(
      /(?:parameter\s+)?([A-Za-z0-9_.]+)\s+([A-Za-z0-9_]+)(?:\s*=\s*([0-9.]+))?/g,
    );
    for (const m of declMatches) {
      if (!keywords.has(m[1]) && !keywords.has(m[2])) {
        components.push({
          type: m[1],
          name: m[2],
          value: m[3] ? parseFloat(m[3]) : undefined,
          properties: {},
        });
      }
    }
  }

  return {
    name: modelName,
    language: "modelica",
    components,
  };
}
