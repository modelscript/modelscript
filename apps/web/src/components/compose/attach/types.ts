// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Attach Wizard framework: shared contracts.
 *
 * A language (QIF, STEP, Modelica, ...) describes how a dropped file becomes an
 * artifact by registering an {@link AttachProfile}. The framework owns the chrome,
 * state machine, navigation, validation and accessibility; a profile only supplies
 * analysis, optional wizard steps, and the final artifact payload.
 */

import type { ComponentType } from "react";

export type AttachIssueSeverity = "error" | "warning" | "info";

export interface AttachIssue {
  severity: AttachIssueSeverity;
  message: string;
}

export interface AttachChip {
  label: string;
  tone?: "neutral" | "success" | "warning" | undefined;
}

/** Where a piece of attached data came from. Surfaced on the posted artifact. */
export type AttachProvenance = "user-provided" | "linked" | "synthesized" | "sample";

export interface AttachUploadResult {
  url: string;
  view_type?: string | undefined;
  svg?: string | undefined;
  thumbnail_url?: string | undefined;
  view_config_additions?: Record<string, unknown> | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AttachArtifactSummary {
  id: number | string;
  title: string;
  viewType: string;
  thumbnailUrl?: string | undefined;
}

export interface AttachCreateArtifactInput {
  artifact_type: string;
  view_config: Record<string, unknown>;
  title: string;
}

/** Side-effect capabilities handed to profiles so they stay unit-testable. */
export interface AttachContext {
  /** Upload a file; `fields` are extra text form fields (server-side preprocessing hints). */
  uploadFile(file: File, options?: { fields?: Record<string, string> }): Promise<AttachUploadResult>;
  /** Create a standalone artifact (used for companions such as a paired STEP model). */
  createArtifact(input: AttachCreateArtifactInput): Promise<{ id: number | string }>;
  /** The caller's own artifacts, optionally filtered by view type. */
  listArtifacts(options: { types: string[] }): Promise<AttachArtifactSummary[]>;
  /** Text source of an existing artifact (for previews/reconciliation), or undefined when unavailable. */
  loadArtifactSource(id: number | string): Promise<string | undefined>;
  /** Persist a new view config on an artifact you own (edit mode). */
  updateArtifact(id: number | string, patch: { view_config: Record<string, unknown> }): Promise<void>;
  /** Load an existing artifact in the shape profiles expect, or undefined when it cannot be read. */
  loadArtifactView(id: number | string): Promise<AttachEditableView | undefined>;
}

/** The stored shape of an artifact, as seen by a profile's edit capability. */
export interface AttachEditableView {
  artifact_type: string;
  title?: string | undefined;
  view_config: Record<string, unknown>;
}

/**
 * Optional capability: derive a *new* artifact from an existing one (e.g. a table becomes a chart).
 * The source artifact is left untouched; the caller decides whether the result replaces or joins it.
 */
export interface AttachDeriveCapability<D> {
  matches(view: AttachEditableView): boolean;
  open(view: AttachEditableView, ctx: AttachContext): Promise<AttachAnalysis<D>>;
  build(draft: D, view: AttachEditableView, ctx: AttachContext): Promise<AttachBuildResult>;
  /** Primary action label (defaults to "Create"). */
  submitLabel?: string | undefined;
  /** Secondary action that closes the wizard without creating anything (defaults to none; ✕ always works). */
  cancelLabel?: string | undefined;
}

/**
 * Optional capability: reopen the wizard on an already-created artifact. `open` rebuilds a draft from the
 * stored config (no original file needed); `apply` returns the replacement config, which the framework saves.
 */
export interface AttachEditCapability<D> {
  /** Synchronous: does this artifact have something worth customizing? */
  matches(view: AttachEditableView): boolean;
  open(view: AttachEditableView, ctx: AttachContext): Promise<AttachAnalysis<D>>;
  apply(draft: D, view: AttachEditableView, ctx: AttachContext): Promise<{ view_config: Record<string, unknown> }>;
}

export interface AttachAnalysis<D> {
  draft: D;
  chips: AttachChip[];
  issues: AttachIssue[];
}

export interface AttachBuildResult {
  artifact_type: string;
  view_config: Record<string, unknown>;
  title: string;
  /** Human-facing title without decoration (e.g. an emoji prefix on `title`), for callbacks and captions. */
  displayTitle?: string | undefined;
  suggestedCaption?: string | undefined;
}

export interface WizardStepProps<D> {
  draft: D;
  /** Merge a patch into the draft, or return a new draft from the previous one. */
  update: (patch: Partial<D> | ((prev: D) => D)) => void;
  issues: AttachIssue[];
  ctx: AttachContext;
}

export interface WizardStep<D> {
  id: string;
  title: string;
  description?: string | undefined;
  /** Hide the step when it has nothing to decide for the current draft. */
  when?: ((draft: D) => boolean) | undefined;
  /** Issues for this step. Any `error` blocks Continue. */
  validate?: ((draft: D) => AttachIssue[]) | undefined;
  skippable?: boolean | undefined;
  Component: ComponentType<WizardStepProps<D>>;
}

export interface AttachProfileMatch {
  /** Lower-case extensions including the dot, e.g. ".qif". */
  extensions: string[];
  /** Extra `accept` tokens such as "image/*". Only used to build the file picker filter. */
  accept?: string[] | undefined;
  /** Optional content sniffing on the first bytes of text, used when the extension is ambiguous. */
  sniff?: ((head: string) => boolean) | undefined;
}

export interface AttachProfile<D = unknown> {
  id: string;
  label: string;
  match: AttachProfileMatch;
  /** Fallback profile used when no other profile matches. Exactly one should set this. */
  fallback?: boolean | undefined;
  analyze(file: File, ctx: AttachContext): Promise<AttachAnalysis<D>>;
  /**
   * Extensions of sibling files that belong with this profile's files when dropped together
   * (e.g. a QIF report and its STEP model). Matching siblings are handed to `withCompanions`
   * instead of being attached on their own.
   */
  companionExtensions?: string[] | undefined;
  /** Fold dropped companion files into the analyzed draft (pre-selecting what the wizard would ask). */
  withCompanions?: ((draft: D, companions: File[]) => Promise<D>) | undefined;
  steps: WizardStep<D>[];
  build(draft: D, ctx: AttachContext): Promise<AttachBuildResult>;
  /** Reopen the wizard on an existing artifact of this kind. */
  edit?: AttachEditCapability<D> | undefined;
  /** Create a new artifact derived from an existing one. */
  derive?: AttachDeriveCapability<D> | undefined;
  /**
   * Fold an existing artifact into a freshly analyzed draft (the artifact-valued sibling of `withCompanions`),
   * e.g. a QIF report opened from an already-attached STEP model.
   */
  withLinkedArtifact?: ((draft: D, linked: AttachArtifactSummary, ctx: AttachContext) => Promise<D>) | undefined;
  /** Optional live preview rendered inside the wizard. */
  Preview?: ComponentType<{ draft: D }> | undefined;
}

export type AnyAttachProfile = AttachProfile<any>;

export type AttachFlowState =
  | { phase: "idle" }
  | { phase: "analyzing"; fileName: string }
  | {
      phase: "wizard";
      profileId: string;
      fileName: string;
      draft: unknown;
      chips: AttachChip[];
      issues: AttachIssue[];
      stepIndex: number;
      /** Present when customizing an existing artifact instead of attaching a new file. */
      edit?: { artifactId: number | string; view: AttachEditableView } | undefined;
      /** Present when deriving a new artifact from an existing one. */
      derive?: { artifactId: number | string; view: AttachEditableView } | undefined;
    }
  | { phase: "building"; fileName: string }
  | { phase: "error"; fileName: string; message: string };
