// SPDX-License-Identifier: AGPL-3.0-or-later

/** Pure (React-free) logic for the attach wizard: step visibility, validation and the flow reducer. */

import type {
  AnyAttachProfile,
  AttachAnalysis,
  AttachArtifactSummary,
  AttachEditableView,
  AttachFlowState,
  AttachIssue,
  WizardStep,
} from "./types";

export function fileExtension(name: string): string {
  const match = /\.[^./\\]+$/.exec(name.toLowerCase());
  return match ? match[0] : "";
}

export function visibleSteps(profile: AnyAttachProfile, draft: unknown): WizardStep<unknown>[] {
  return profile.steps.filter((s: WizardStep<unknown>) => !s.when || s.when(draft));
}

export function stepIssues(step: WizardStep<unknown>, draft: unknown): AttachIssue[] {
  return step.validate ? step.validate(draft) : [];
}

export function hasBlocking(issues: AttachIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/** Blocking issues across the analysis result and every visible step. */
export function allBlockingIssues(
  profile: AnyAttachProfile,
  draft: unknown,
  analysisIssues: AttachIssue[],
): AttachIssue[] {
  const fromSteps = visibleSteps(profile, draft).flatMap((s) => stepIssues(s, draft));
  return [...analysisIssues, ...fromSteps].filter((i) => i.severity === "error");
}

/** The wizard is only shown when there is a decision to make or something to report. */
export function needsWizard(profile: AnyAttachProfile, analysis: AttachAnalysis<unknown>): boolean {
  return visibleSteps(profile, analysis.draft).length > 0 || hasBlocking(analysis.issues);
}

/** Clamp a step index to the currently visible steps (visibility can change as the draft changes). */
export function clampStepIndex(profile: AnyAttachProfile, draft: unknown, index: number): number {
  const count = visibleSteps(profile, draft).length;
  if (count === 0) return 0;
  return Math.max(0, Math.min(index, count - 1));
}

export type AttachFlowAction =
  | { type: "analyze-start"; fileName: string }
  | {
      type: "analyzed";
      profileId: string;
      fileName: string;
      analysis: AttachAnalysis<unknown>;
      edit?: { artifactId: number | string; view: AttachEditableView } | undefined;
      derive?: { artifactId: number | string; view: AttachEditableView } | undefined;
    }
  | { type: "patch-draft"; draft: unknown }
  /** Apply a patch (object merge or pure updater) to the *latest* draft, so async step handlers never see stale state. */
  | { type: "update-draft"; patch: unknown }
  | { type: "goto"; stepIndex: number }
  | { type: "build-start"; fileName: string }
  | { type: "failed"; fileName: string; message: string }
  | { type: "reset" };

export function attachFlowReducer(state: AttachFlowState, action: AttachFlowAction): AttachFlowState {
  switch (action.type) {
    case "analyze-start":
      return { phase: "analyzing", fileName: action.fileName };
    case "analyzed":
      return {
        phase: "wizard",
        profileId: action.profileId,
        fileName: action.fileName,
        draft: action.analysis.draft,
        chips: action.analysis.chips,
        issues: action.analysis.issues,
        stepIndex: 0,
        ...(action.edit ? { edit: action.edit } : {}),
        ...(action.derive ? { derive: action.derive } : {}),
      };
    case "patch-draft":
      return state.phase === "wizard" ? { ...state, draft: action.draft } : state;
    case "update-draft": {
      if (state.phase !== "wizard") return state;
      const next =
        typeof action.patch === "function"
          ? (action.patch as (draft: unknown) => unknown)(state.draft)
          : { ...(state.draft as object), ...(action.patch as object) };
      return next === state.draft ? state : { ...state, draft: next };
    }
    case "goto":
      return state.phase === "wizard" ? { ...state, stepIndex: Math.max(0, action.stepIndex) } : state;
    case "build-start":
      return { phase: "building", fileName: action.fileName };
    case "failed":
      return { phase: "error", fileName: action.fileName, message: action.message };
    case "reset":
      return { phase: "idle" };
  }
}

export interface BatchEntry {
  file: File;
  /** Sibling files folded into this entry by its profile (see `AttachProfile.companionExtensions`). */
  companions: File[];
  /** An existing artifact to fold into the draft (see `AttachProfile.withLinkedArtifact`). */
  linked?: AttachArtifactSummary | undefined;
}

/**
 * Group a multi-file drop: files that a profile declares as companions of another dropped file
 * (e.g. `.step` next to `.qif`) are claimed by it and no longer attach on their own. Order is preserved.
 */
export function planBatch(files: File[], resolve: (fileName: string) => AnyAttachProfile | undefined): BatchEntry[] {
  const claimed = new Set<File>();
  const companionsOf = new Map<File, File[]>();

  for (const file of files) {
    if (claimed.has(file)) continue;
    const exts = resolve(file.name)?.companionExtensions;
    if (!exts || exts.length === 0) continue;
    const match = files.find(
      (other) => other !== file && !claimed.has(other) && exts.includes(fileExtension(other.name)),
    );
    if (match) {
      claimed.add(match);
      companionsOf.set(file, [match]);
    }
  }

  return files.filter((f) => !claimed.has(f)).map((file) => ({ file, companions: companionsOf.get(file) ?? [] }));
}
