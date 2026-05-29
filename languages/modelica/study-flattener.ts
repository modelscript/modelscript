/* eslint-disable @typescript-eslint/no-explicit-any */
import type { QueryDB, SymbolEntry, SymbolId } from "@modelscript/compiler";
import { type ModelicaModArgs } from "./modification-args.js";

/**
 * Represents the extracted configuration of a Study.
 */
export interface StudyConfiguration {
  name: string;
  workflowClass: string | null;
  targetClass: string | null;
  parameters: Record<string, unknown>;
  targetModifications: ModelicaModArgs | null;
}

export class StudyFlattener {
  constructor(private db: QueryDB) {}

  flatten(classId: SymbolId): StudyConfiguration {
    const rootEntry = this.db.symbol(classId);
    if (!rootEntry) throw new Error("Study class not found");

    const config: StudyConfiguration = {
      name: rootEntry.name,
      workflowClass: null,
      targetClass: null,
      parameters: {},
      targetModifications: null,
    };

    const children = this.db.childrenOf(classId);

    // Process extends clauses to separate workflow from target model
    for (const child of children) {
      if (child.kind === "Extends") {
        const baseEntry = this.db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
        if (!baseEntry) continue;

        // Is this a built-in study/workflow class?

        if (
          baseEntry.name.includes("ModelScript.Studies") ||
          baseEntry.name === "TransientSimulation" ||
          baseEntry.name === "StaticStructuralFEA" ||
          baseEntry.name === "MonteCarlo"
        ) {
          config.workflowClass = baseEntry.name;

          // Extract workflow parameters
          const localMod = this.db.query<ModelicaModArgs | null>("extendsModificationParsed", child.id);
          if (localMod) {
            for (const arg of localMod.args) {
              if (arg.value) {
                let val = this.db.evaluate(arg.value, arg.evaluationScopeId || child.parentId);
                if (val === null && arg.value.kind === "expression" && typeof (arg.value as any).text === "string") {
                  val = Number((arg.value as any).text);
                  if (isNaN(val as number)) val = (arg.value as any).text.replace(/^"|"$/g, "");
                }
                config.parameters[arg.name] = val;
              }
            }
          }
        } else {
          // It is the target model
          config.targetClass = baseEntry.name;
          config.targetModifications = this.db.query<ModelicaModArgs | null>("extendsModificationParsed", child.id);
        }
      }
    }

    // Process direct parameters in the study class
    for (const child of children) {
      if (child.kind === "Component") {
        const varType = this.db.query<any>("variability", child.id);
        if (varType === "parameter") {
          const inlineMod = this.db.query<ModelicaModArgs | null>("effectiveModification", child.id);
          if (inlineMod && inlineMod.args.length > 0 && inlineMod.args[0]?.value) {
            let val = this.db.evaluate(inlineMod.args[0].value, child.parentId);
            if (
              val === null &&
              inlineMod.args[0].value.kind === "expression" &&
              typeof (inlineMod.args[0].value as any).text === "string"
            ) {
              val = Number((inlineMod.args[0].value as any).text);
              if (isNaN(val as number)) val = (inlineMod.args[0].value as any).text.replace(/^"|"$/g, "");
            }
            config.parameters[child.name] = val;
          }
        }
      }
    }

    return config;
  }
}
