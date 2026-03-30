// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Javascript interoperability. Parses JS/TS exports into Modelica components.
 */

import type { Scope } from "../scope.js";
import {
  ModelicaClassInstance,
  ModelicaComponentInstance,
  type ModelicaElement,
  type ModelicaNamedElement,
} from "./model.js";
import { ModelicaCausality, ModelicaClassKind, type ModelicaIdentifierSyntaxNode } from "./syntax.js";

/**
 * A Modelica class instance backed by a Javascript/Typescript file.
 */
export class ModelicaJavascriptEntity extends ModelicaClassInstance {
  jsPath: string;
  jsSource: string | null = null;
  #syntheticComponents: ModelicaComponentInstance[] = [];
  #loaded = false;

  constructor(parent: Scope, path: string) {
    super(parent);
    this.jsPath = path;
    this.classKind = ModelicaClassKind.PACKAGE;
  }

  override clone(): ModelicaClassInstance {
    if (!this.#loaded) this.load();
    const cloned = new ModelicaJavascriptEntity(this.parent ?? this, this.jsPath);
    cloned.name = this.name;
    cloned.jsSource = this.jsSource;
    cloned.#loaded = true;
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

      if (!this.jsSource) return;

      const types = {
        number: this.root?.resolveSimpleName("Real") as ModelicaClassInstance | null,
        boolean: this.root?.resolveSimpleName("Boolean") as ModelicaClassInstance | null,
        string: this.root?.resolveSimpleName("String") as ModelicaClassInstance | null,
      };

      // Extract functions
      // export function add(a, b) { ... }
      // export function multiply(a: number, b: number): number { ... }
      const funcRegex = /export\s+function\s+([a-zA-Z_$][\w$]*)\s*\(([^)]*)\)(?:\s*:\s*([a-zA-Z_$][\w$]*))?/g;
      let match;
      while ((match = funcRegex.exec(this.jsSource)) !== null) {
        const funcName = match[1];
        const argsStr = match[2] ?? "";
        const returnTypeStr = match[3] ?? "number";

        if (!funcName) continue;

        const funcClass = new ModelicaClassInstance(this);
        funcClass.name = funcName;
        funcClass.classKind = ModelicaClassKind.FUNCTION;
        funcClass.instantiated = true;
        funcClass.declaredElements = [];

        // Parse arguments
        const args = argsStr
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const arg of args) {
          const parts = arg.split(":").map((s) => s.trim());
          const argName = parts[0];
          const argType = parts[1] ?? "number";

          if (argName) {
            const inputComp = new ModelicaComponentInstance(funcClass, null);
            inputComp.name = argName;
            inputComp.causality = ModelicaCausality.INPUT;
            const baseType = types[argType as keyof typeof types] || types.number;
            if (baseType) inputComp.classInstance = baseType.clone();
            inputComp.instantiated = true;
            funcClass.declaredElements.push(inputComp);
          }
        }

        // Return value
        const outputComp = new ModelicaComponentInstance(funcClass, null);
        outputComp.name = "result";
        outputComp.causality = ModelicaCausality.OUTPUT;
        const baseRetType = types[returnTypeStr as keyof typeof types] || types.number;
        if (baseRetType) outputComp.classInstance = baseRetType.clone();
        outputComp.instantiated = true;
        funcClass.declaredElements.push(outputComp);

        const comp = new ModelicaComponentInstance(this, null);
        comp.name = funcName;
        comp.classInstance = funcClass;
        comp.instantiated = true;
        this.#syntheticComponents.push(comp);
        this.declaredElements.push(comp);
      }

      // Allow parsing: export const FOO = 42;
      const constRegex = /export\s+const\s+([a-zA-Z_$][\w$]*)\s*=/g;
      while ((match = constRegex.exec(this.jsSource)) !== null) {
        const constName = match[1];
        if (!constName) continue;
        const comp = new ModelicaComponentInstance(this, null);
        comp.name = constName;
        const baseType = types.number;
        if (baseType) comp.classInstance = baseType.clone();
        comp.instantiated = true;
        this.#syntheticComponents.push(comp);
        this.declaredElements.push(comp);
      }

      // Allow parsing export { a, b, c };
      const blockExportRegex = /export\s*\{([^}]*)\}/g;
      while ((match = blockExportRegex.exec(this.jsSource)) !== null) {
        const names = (match[1] || "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const name of names) {
          // just assume function/variable
          const comp = new ModelicaComponentInstance(this, null);
          comp.name = name;
          // By default, make it a function for simplicity
          const funcClass = new ModelicaClassInstance(this);
          funcClass.name = name;
          funcClass.classKind = ModelicaClassKind.FUNCTION;
          funcClass.instantiated = true;
          funcClass.declaredElements = [];
          comp.classInstance = funcClass;
          comp.instantiated = true;
          this.#syntheticComponents.push(comp);
          this.declaredElements.push(comp);
        }
      }

      this.instantiated = true;
    } finally {
      this.instantiating = false;
    }
  }

  load(): void {
    if (this.#loaded) return;
    this.#loaded = true;

    if (this.jsSource !== null) return;

    const context = this.context;
    if (context) {
      try {
        const data = context.fs.read(this.jsPath);
        this.jsSource = data;
        if (!this.name) {
          const basename = this.jsPath.split(/[/\\]/).pop() || this.jsPath;
          this.name = basename.replace(/\.[tj]s$/, "");
        }
      } catch {
        console.warn(`[ModelicaJavascriptEntity] Failed to read JS file: ${this.jsPath}`);
      }
    }
  }
}
