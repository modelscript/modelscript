// SPDX-License-Identifier: AGPL-3.0-or-later

import { PolyglotTransformer } from "./polyglot-transformer.js";

export interface PipelineStage {
  name: string;
  sourceLang: string;
  targetLang: string;
  transformer: PolyglotTransformer;
  traceMap: Map<string, string>; // sourceNodeName -> targetNodeName
}

/**
 * Multi-Stage Polyglot Transformation Pipeline.
 * Enables sequential staged transformations (e.g., ReqIF -> SysML v2 -> Modelica -> DAE)
 * with formal category arrow trace composition:
 *   τ_{1 -> 3} = τ_{2 -> 3} ∘ τ_{1 -> 2}
 */
export class TransformationPipeline {
  private stages: PipelineStage[] = [];

  addStage(
    name: string,
    sourceLang: string,
    targetLang: string,
    transformer: PolyglotTransformer = new PolyglotTransformer(),
  ): this {
    this.stages.push({
      name,
      sourceLang,
      targetLang,
      transformer,
      traceMap: new Map<string, string>(),
    });
    return this;
  }

  getStageCount(): number {
    return this.stages.length;
  }

  recordStageTrace(stageIndex: number, sourceName: string, targetName: string): void {
    if (stageIndex >= 0 && stageIndex < this.stages.length) {
      this.stages[stageIndex].traceMap.set(sourceName, targetName);
    }
  }

  /**
   * Evaluates categorical arrow trace composition across all pipeline stages:
   * Traces an entity from the first stage through intermediate stages to the final stage.
   */
  composeTrace(initialNodeName: string): string | undefined {
    let current: string | undefined = initialNodeName;
    for (const stage of this.stages) {
      if (!current) break;
      current = stage.traceMap.get(current);
    }
    return current;
  }

  /**
   * Reverse lineage trace: given a final target entity, traces backward to the root source.
   */
  traceLineage(finalNodeName: string): string[] {
    const lineage: string[] = [finalNodeName];
    let current = finalNodeName;

    for (let i = this.stages.length - 1; i >= 0; i--) {
      const stage = this.stages[i];
      let foundSource: string | undefined;
      for (const [src, tgt] of stage.traceMap.entries()) {
        if (tgt === current) {
          foundSource = src;
          break;
        }
      }
      if (foundSource) {
        lineage.unshift(foundSource);
        current = foundSource;
      } else {
        break;
      }
    }

    return lineage;
  }
}
