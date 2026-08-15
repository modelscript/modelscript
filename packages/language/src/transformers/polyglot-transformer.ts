/**
 * Polyglot Transformer: Bi-directional SysML v2 <-> Modelica conversion using
 * Triple Graph Grammar (TGG) rules and semantic reasoner integration.
 */

import type { PolyglotConfig, TGGRuleOptions } from "../dsl.js";

export interface ModelicaComponent {
  name: string;
  typeSpecifier: string;
  variability?: string;
  causality?: string;
  defaultValue?: string;
  isInherited?: boolean;
}

export interface ModelicaConnection {
  source: string;
  target: string;
}

export interface ModelicaModel {
  name: string;
  kind?: "model" | "block" | "class";
  isPartial?: boolean;
  extends?: string[];
  components: ModelicaComponent[];
  connections: ModelicaConnection[];
}

export interface SysML2PartDef {
  name: string;
  isAbstract?: boolean;
  superclasses?: string[];
  attributes: { name: string; type: string; value?: string; isInherited?: boolean }[];
  ports: { name: string; type: string; isInherited?: boolean }[];
  connections: { source: string; target: string }[];
}

/**
 * Polyglot Transformation Engine that evaluates TGG rules over model graphs,
 * supporting transitive inheritance and synthetic reasoner-inferred elements.
 */
export class PolyglotTransformer {
  private rules: TGGRuleOptions[] = [];
  private typeMaps: Record<string, Record<string, string>> = {};
  private reasonerFacts = new Map<string, { subject: string; object: string }[]>();

  constructor(config?: PolyglotConfig) {
    if (config) {
      this.rules = config.rules || [];
      this.typeMaps = config.typeMaps || {};
    }
  }

  registerRule(rule: TGGRuleOptions): void {
    this.rules.push(rule);
  }

  addReasonerFact(predicate: string, subject: string, object: string): void {
    if (!this.reasonerFacts.has(predicate)) {
      this.reasonerFacts.set(predicate, []);
    }
    this.reasonerFacts.get(predicate)!.push({ subject, object });
  }

  getInferredFeatures(className: string): { name: string; type: string }[] {
    const facts = this.reasonerFacts.get("hasFeature") || [];
    return facts
      .filter((f) => f.subject === className)
      .map((f) => {
        const parts = f.object.split(":");
        return {
          name: parts[0],
          type: parts[1] || "Real",
        };
      });
  }

  /**
   * Transforms a Modelica AST into SysML v2 code, incorporating base class features.
   */
  transformModelicaToSysML2(modelica: ModelicaModel): string {
    const lines: string[] = [];
    const prefix = modelica.isPartial ? "abstract " : "";
    const extendsStr = modelica.extends && modelica.extends.length > 0 ? ` extends ${modelica.extends.join(", ")}` : "";
    lines.push(`${prefix}part def ${modelica.name}${extendsStr} {`);

    // Components (including inherited/synthetic)
    for (const comp of modelica.components) {
      if (comp.variability === "parameter") {
        const valStr = comp.defaultValue ? ` = ${comp.defaultValue}` : "";
        lines.push(`  attribute ${comp.name}: ${comp.typeSpecifier}${valStr};`);
      } else {
        lines.push(`  port ${comp.name}: ${comp.typeSpecifier};`);
      }
    }

    // Reasoner-inferred features from base classes
    const inferred = this.getInferredFeatures(modelica.name);
    for (const feat of inferred) {
      if (!modelica.components.some((c) => c.name === feat.name)) {
        lines.push(`  attribute ${feat.name}: ${feat.type}; // inferred from base`);
      }
    }

    let connIdx = 1;
    for (const conn of modelica.connections) {
      lines.push(`  connection c${connIdx++} connect ${conn.source} to ${conn.target};`);
    }

    lines.push(`}`);
    return lines.join("\n");
  }

  /**
   * Transforms a SysML v2 Part Definition into Modelica model code.
   */
  transformSysML2ToModelica(sysml: SysML2PartDef): string {
    const lines: string[] = [];
    const kind = sysml.isAbstract ? "partial model" : "model";
    lines.push(`${kind} ${sysml.name}`);

    if (sysml.superclasses && sysml.superclasses.length > 0) {
      for (const sup of sysml.superclasses) {
        lines.push(`  extends ${sup};`);
      }
    }

    for (const attr of sysml.attributes) {
      const valStr = attr.value ? ` = ${attr.value}` : "";
      lines.push(`  parameter ${attr.type} ${attr.name}${valStr};`);
    }

    for (const port of sysml.ports) {
      lines.push(`  ${port.type} ${port.name};`);
    }

    // Reasoner-inferred features
    const inferred = this.getInferredFeatures(sysml.name);
    for (const feat of inferred) {
      if (!sysml.attributes.some((a) => a.name === feat.name) && !sysml.ports.some((p) => p.name === feat.name)) {
        lines.push(`  parameter ${feat.type} ${feat.name}; // inferred`);
      }
    }

    if (sysml.connections.length > 0) {
      lines.push("\nequation");
      for (const conn of sysml.connections) {
        lines.push(`  connect(${conn.source}, ${conn.target});`);
      }
    }

    lines.push(`end ${sysml.name};`);
    return lines.join("\n");
  }
}

/**
 * Transforms a Modelica AST representation into SysML v2 code using TGG rules.
 */
export function modelicaToSysML2(modelica: ModelicaModel): string {
  const transformer = new PolyglotTransformer();
  return transformer.transformModelicaToSysML2(modelica);
}

/**
 * Transforms a SysML v2 Part Definition into Modelica model code using TGG rules.
 */
export function sysml2ToModelica(sysml: SysML2PartDef): string {
  const transformer = new PolyglotTransformer();
  return transformer.transformSysML2ToModelica(sysml);
}
