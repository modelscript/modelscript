// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU (Functional Mock-up Interface) entity support.
 *
 * When an FMI 2.0 `modelDescription.xml` file is found in the workspace,
 * it is represented as a `ModelicaFmuEntity` — a specialization of
 * `ModelicaClassInstance` that exposes FMU scalar variables as synthetic
 * Modelica component instances.  This lets other Modelica models reference
 * FMU participants seamlessly via normal name resolution and `connect`
 * equations.
 */

import type { Scope } from "../scope.js";
import type { IModelicaModelVisitor } from "./model.js";
import {
  ModelicaClassInstance,
  ModelicaComponentInstance,
  type ModelicaElement,
  type ModelicaNamedElement,
} from "./model.js";
import { ModelicaCausality, ModelicaClassKind, type ModelicaIdentifierSyntaxNode } from "./syntax.js";

// ── FMU model description types ──

interface FmuScalarVariable {
  name: string;
  causality: "input" | "output" | "local" | "parameter" | "calculatedParameter" | "independent";
  variability: "continuous" | "discrete" | "fixed" | "tunable" | "constant";
  description: string;
  start?: number;
}

// ── XML parsing ──

/**
 * Parse scalar variables from an FMI 2.0 `modelDescription.xml` string.
 * Uses lightweight regex matching — no DOM parser required.
 */
function parseFmuModelDescription(xml: string): {
  modelName: string;
  description: string;
  variables: FmuScalarVariable[];
} {
  // Extract modelName
  const nameMatch = xml.match(/modelName\s*=\s*"([^"]*)"/);
  const modelName = nameMatch?.[1] ?? "FMU";

  // Extract top-level description
  const descMatch = xml.match(/<fmiModelDescription[^>]*\bdescription\s*=\s*"([^"]*)"/);
  const description = descMatch?.[1] ?? "";

  // Extract scalar variables
  const variables: FmuScalarVariable[] = [];
  const scalarRegex =
    /<ScalarVariable\b([^>]*)\/?>[\s\S]*?(?:<\/ScalarVariable>|(?=<ScalarVariable|<\/ModelVariables))/g;
  let match: RegExpExecArray | null;

  while ((match = scalarRegex.exec(xml)) !== null) {
    const attrs = match[0] ?? "";
    const headerAttrs = match[1] ?? "";

    const varName = headerAttrs.match(/\bname\s*=\s*"([^"]*)"/)?.[1];
    if (!varName) continue;

    const causality = (headerAttrs.match(/\bcausality\s*=\s*"([^"]*)"/)?.[1] ??
      "local") as FmuScalarVariable["causality"];
    const variability = (headerAttrs.match(/\bvariability\s*=\s*"([^"]*)"/)?.[1] ??
      "continuous") as FmuScalarVariable["variability"];
    const varDesc = headerAttrs.match(/\bdescription\s*=\s*"([^"]*)"/)?.[1] ?? "";

    // Extract start value from nested <Real>, <Integer>, etc.
    const startMatch = attrs.match(/\bstart\s*=\s*"([^"]*)"/);
    const start = startMatch ? parseFloat(startMatch[1] ?? "") : undefined;

    variables.push({
      name: varName,
      causality,
      variability,
      description: varDesc,
      ...(Number.isFinite(start) ? { start: start as number } : {}),
    });
  }

  return { modelName, description, variables };
}

// ── ModelicaFmuEntity ──

/**
 * A Modelica class instance backed by an FMI 2.0 model description XML file.
 *
 * Acts as a `block` with input/output connectors derived from the FMU's
 * scalar variables.  The instantiation algorithm creates synthetic
 * `ModelicaComponentInstance` objects for each variable, so that other
 * Modelica models can reference them via normal name resolution.
 */
export class ModelicaFmuEntity extends ModelicaClassInstance {
  /** Absolute path to the model description XML file. */
  path: string;
  /** Parsed FMU scalar variables. */
  fmuVariables: FmuScalarVariable[] = [];
  /** Synthetic component instances created during instantiation. */
  #syntheticComponents: ModelicaComponentInstance[] = [];
  #loaded = false;
  /** Raw XML content (for browser/memfs environments where path may not be readable). */
  #xmlContent: string | null = null;

  constructor(parent: Scope, path: string, xmlContent?: string) {
    super(parent);
    this.path = path;
    this.classKind = ModelicaClassKind.BLOCK;
    this.#xmlContent = xmlContent ?? null;
  }

  /** Load from pre-supplied XML content (for browser memfs environments). */
  static fromXml(parent: Scope, name: string, xmlContent: string): ModelicaFmuEntity {
    const entity = new ModelicaFmuEntity(parent, `__fmu__:${name}`, xmlContent);
    entity.name = name;
    return entity;
  }

  override accept<R, A>(visitor: IModelicaModelVisitor<R, A>, argument?: A): R {
    return visitor.visitClassInstance(this, argument);
  }

  override clone(modification?: import("./model.js").ModelicaModification | null): ModelicaClassInstance {
    if (!this.#loaded) this.load();
    const cloned = new ModelicaFmuEntity(this.parent ?? this, this.path, this.#xmlContent ?? undefined);
    cloned.name = this.name;
    cloned.fmuVariables = this.fmuVariables;
    cloned.#loaded = true;
    if (modification) {
      // FMU entities don't use Modelica modifications, but pass through for compatibility
    }
    cloned.instantiate();
    return cloned;
  }

  override get elements(): IterableIterator<ModelicaElement> {
    if (!this.instantiated && !this.instantiating) this.instantiate();
    const components = this.#syntheticComponents;
    return (function* () {
      yield* components;
    })();
  }

  override resolveSimpleName(
    identifier: ModelicaIdentifierSyntaxNode | string | null | undefined,
    global = false,
    encapsulated = false,
  ): ModelicaNamedElement | null {
    const simpleName = typeof identifier === "string" ? identifier : identifier?.text;
    if (!simpleName) return null;
    if (!this.instantiated && !this.instantiating) this.instantiate();

    // Check synthetic components
    for (const comp of this.#syntheticComponents) {
      if (comp.name === simpleName) return comp;
    }

    return super.resolveSimpleName(identifier, global, encapsulated);
  }

  override instantiate(): void {
    if (this.instantiated) return;
    if (this.instantiating) return;
    this.instantiating = true;
    try {
      if (!this.#loaded) this.load();
      this.declaredElements = [];
      this.#syntheticComponents = [];

      // Resolve the predefined Real type for component class instances
      const realType = this.root?.resolveSimpleName("Real") as ModelicaClassInstance | null;

      for (const v of this.fmuVariables) {
        // Create a synthetic component instance with null AST node
        const comp = new ModelicaComponentInstance(this, null);
        comp.name = v.name;
        comp.description = v.description || null;

        // Set causality from FMU variable
        if (v.causality === "input") {
          comp.causality = ModelicaCausality.INPUT;
        } else if (v.causality === "output") {
          comp.causality = ModelicaCausality.OUTPUT;
        }

        // Set the class instance to Real (all FMU 2.0 continuous variables are Real)
        if (realType) {
          comp.classInstance = realType.clone();
        }

        comp.instantiated = true;
        this.#syntheticComponents.push(comp);
        this.declaredElements.push(comp);
      }

      this.instantiated = true;
    } finally {
      this.instantiating = false;
    }
  }

  /** Read and parse the model description XML. */
  load(): void {
    if (this.#loaded) return;
    this.#loaded = true;

    let xmlContent = this.#xmlContent;

    // Try reading from filesystem if no pre-supplied content
    if (!xmlContent) {
      const context = this.context;
      if (context) {
        try {
          xmlContent = context.fs.read(this.path);
          this.#xmlContent = xmlContent;
        } catch {
          console.warn(`[ModelicaFmuEntity] Failed to read FMU XML: ${this.path}`);
          return;
        }
      }
    }

    if (!xmlContent) return;

    const parsed = parseFmuModelDescription(xmlContent);
    if (!this.name) {
      this.name = parsed.modelName;
    }
    this.description = parsed.description || this.description;
    this.fmuVariables = parsed.variables;
  }
}
