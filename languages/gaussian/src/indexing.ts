// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `@modelscript/gaussian` — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes Gaussian input files (`.gjf`, `.com`) into `UnifiedWorkspace`.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseGaussianInput } from "./parser/gjf-parser.js";

export const gaussianIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".gjf") || lower.endsWith(".com")) {
      return true;
    }
    if (!text) return false;
    return /^\s*%(?:chk|mem|nprocshared|nproc|rwf)\s*=/im.test(text) || /^\s*#[pPnNtT]?\s+\S+\/\S+/m.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseGaussianInput(ctx.text);
    ctx.setParsedModel(doc);

    for (const job of doc.jobs) {
      const jobName = job.title?.trim() || `GaussianJob_${job.stepIndex + 1}`;
      const jobRootId = ctx.addSymbol(
        jobName,
        "Package",
        null,
        job.startOffset,
        job.endOffset,
        {
          stepIndex: job.stepIndex,
          method: job.route?.method,
          basisSet: job.route?.basisSet,
          charge: job.charge,
          multiplicity: job.multiplicity,
          atomCount: job.atoms.length,
        },
        {
          ruleName: "JobStep",
          namePath: "title",
        },
      );

      // Index Z-matrix variables & constants
      for (const v of job.variableEntries) {
        ctx.addSymbol(
          v.name,
          v.isConstant ? "Constant" : "Variable",
          jobRootId,
          v.startOffset,
          v.endOffset,
          {
            value: v.value,
            isConstant: v.isConstant,
          },
          {
            ruleName: "VariableAssignment",
            namePath: "name",
          },
        );
      }

      // Index atoms
      for (const atom of job.atoms) {
        ctx.addSymbol(
          `${atom.element}${atom.index}`,
          "Component",
          jobRootId,
          atom.startOffset,
          atom.endOffset,
          {
            index: atom.index,
            element: atom.element,
            atomicNumber: atom.atomicNumber,
            kind: atom.kind,
            isDummy: atom.isDummy,
          },
          {
            ruleName: "AtomSpec",
            namePath: "element",
          },
        );
      }
    }
  },
};
