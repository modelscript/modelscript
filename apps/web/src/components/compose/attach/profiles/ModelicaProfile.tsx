// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { ChoiceCards, IssueList } from "../Primitives";
import type { AttachAnalysis, AttachChip, AttachIssue, AttachProfile, WizardStepProps } from "../types";
import {
  defaultModelicaClass,
  type ModelicaClassInfo,
  scanModelicaClasses,
  selectableModelicaClasses,
} from "./modelica-classes";

export type ModelicaOpenAs = "diagram" | "simulation" | "code";

export interface ModelicaAttachDraft {
  file: File;
  text: string;
  classes: ModelicaClassInfo[];
  candidates: ModelicaClassInfo[];
  /** Qualified name of the class to showcase. */
  selected?: string | undefined;
  openAs: ModelicaOpenAs;
  /** Edit mode: what the artifact had when it was opened, so `apply` only changes what the user changed. */
  initialSelected?: string | undefined;
  initialOpenAs: ModelicaOpenAs;
  /** Edit mode: show the step even when the file has a single model (the user asked to customize). */
  forceStep?: boolean | undefined;
}

const MAX_INLINE_CODE = 250_000;

function classHint(c: ModelicaClassInfo): string {
  const bits: string[] = [c.kind];
  if (c.partial) bits.push("partial");
  if (c.hasExperiment) bits.push("has experiment");
  return bits.join(" · ");
}

const ModelicaStep: React.FC<WizardStepProps<ModelicaAttachDraft>> = ({ draft, update, issues }) => {
  const recommended = defaultModelicaClass(draft.candidates)?.qualifiedName;
  const selectedInfo = draft.candidates.find((c) => c.qualifiedName === draft.selected);
  return (
    <>
      {draft.candidates.length > 1 && (
        <div style={{ maxHeight: 220, overflowY: "auto", padding: 2 }}>
          <ChoiceCards<string>
            label="Model to show"
            value={draft.selected}
            onChange={(value) => update({ selected: value })}
            options={draft.candidates.map((c) => ({
              value: c.qualifiedName,
              title: c.qualifiedName,
              hint: classHint(c),
              recommended: c.qualifiedName === recommended,
            }))}
          />
        </div>
      )}
      <ChoiceCards<ModelicaOpenAs>
        label="Open as"
        value={draft.openAs}
        onChange={(value) => update({ openAs: value })}
        options={[
          { value: "diagram", title: "Diagram", hint: "Schematic of the model" },
          {
            value: "simulation",
            title: "Simulation",
            hint: selectedInfo?.hasExperiment ? "Uses the model's experiment settings" : "Runs with default settings",
            recommended: Boolean(selectedInfo?.hasExperiment),
          },
          { value: "code", title: "Code", hint: "Source first" },
        ]}
      />
      <IssueList issues={issues.filter((i) => i.severity !== "error")} />
    </>
  );
};

export const modelicaAttachProfile: AttachProfile<ModelicaAttachDraft> = {
  id: "modelica",
  label: "Modelica",
  match: { extensions: [".mo"] },

  async analyze(file): Promise<AttachAnalysis<ModelicaAttachDraft>> {
    const text = await file.text();
    const classes = scanModelicaClasses(text);
    const candidates = selectableModelicaClasses(classes);
    const chips: AttachChip[] = [];
    const issues: AttachIssue[] = [];

    if (text.trim().length === 0) {
      issues.push({ severity: "error", message: "This file is empty." });
    } else if (classes.length === 0) {
      // Not necessarily wrong (the server parser is authoritative), but worth saying.
      issues.push({ severity: "warning", message: "No class declarations were found in this file." });
    } else {
      chips.push({ label: `${classes.length} class${classes.length === 1 ? "" : "es"}` });
      if (candidates.some((c) => c.hasExperiment)) chips.push({ label: "Has experiment", tone: "success" });
    }

    const draft: ModelicaAttachDraft = {
      file,
      text,
      classes,
      candidates,
      selected: defaultModelicaClass(candidates)?.qualifiedName,
      openAs: "diagram",
      initialOpenAs: "diagram",
    };
    return { draft, chips, issues };
  },

  steps: [
    {
      id: "model",
      title: "Which model should we show?",
      description: "Pick the model to feature and how the morsel first opens. Everything else stays in the source.",
      // Only a real decision: more than one candidate.
      when: (d) => Boolean(d.forceStep) || d.candidates.length > 1,
      validate: (d) => (d.selected ? [] : [{ severity: "error", message: "Pick a model to show." }]),
      Component: ModelicaStep,
    },
  ],

  edit: {
    matches: (view) =>
      view.artifact_type.toLowerCase().startsWith("modelica") &&
      (typeof view.view_config["code"] === "string" || typeof view.view_config["url"] === "string"),

    async open(view, ctx) {
      const config = view.view_config;
      let text = typeof config["code"] === "string" ? config["code"] : "";
      if (!text.trim() && typeof config["url"] === "string") {
        const res = await fetch(config["url"]);
        if (!res.ok) throw new Error("The model source could not be loaded.");
        text = await res.text();
      }
      if (!text.trim()) throw new Error("This morsel has no Modelica source to customize.");

      const file = new File([text], view.title ? `${view.title}.mo` : "model.mo");
      const analysis = await modelicaAttachProfile.analyze(file, ctx);
      const previewMode = config["previewMode"];
      const openAs: ModelicaOpenAs = previewMode === "simulation" || previewMode === "code" ? previewMode : "diagram";
      const stored = typeof config["primaryClass"] === "string" ? config["primaryClass"] : undefined;
      const selected =
        stored && analysis.draft.candidates.some((c) => c.qualifiedName === stored) ? stored : analysis.draft.selected;
      analysis.draft = {
        ...analysis.draft,
        selected,
        openAs,
        initialSelected: selected,
        initialOpenAs: openAs,
        forceStep: true,
      };
      return analysis;
    },

    async apply(draft, view, ctx) {
      const patch: Record<string, unknown> = {};
      const classChanged =
        draft.candidates.length > 1 && Boolean(draft.selected) && draft.selected !== draft.initialSelected;
      if (classChanged) {
        // The thumbnail/diagram is rendered server-side per class, so re-render for the new choice.
        const upload = await ctx.uploadFile(draft.file, { fields: { primary_class: draft.selected! } });
        Object.assign(patch, {
          url: upload.url,
          svg: upload.svg ?? undefined,
          thumbnailUrl: upload.thumbnail_url ?? undefined,
          ...(upload.view_config_additions || {}),
          ...(upload.metadata || {}),
          primaryClass: draft.selected,
        });
      }
      if (draft.openAs !== draft.initialOpenAs) patch["previewMode"] = draft.openAs;
      return { view_config: { ...view.view_config, ...patch } };
    },
  },

  async build(draft, ctx) {
    const chosen = draft.candidates.length > 1 ? draft.selected : undefined;
    const upload = await ctx.uploadFile(draft.file, chosen ? { fields: { primary_class: chosen } } : undefined);
    return {
      artifact_type: upload.view_type && upload.view_type !== "other" ? upload.view_type : "modelica-diagram",
      title: draft.file.name,
      suggestedCaption: chosen ? `Modelica model ${chosen}.` : undefined,
      view_config: {
        url: upload.url,
        ...(upload.svg ? { svg: upload.svg } : {}),
        ...(upload.thumbnail_url ? { thumbnailUrl: upload.thumbnail_url } : {}),
        ...(upload.view_config_additions || {}),
        ...(upload.metadata || {}),
        ...(draft.text.length <= MAX_INLINE_CODE ? { code: draft.text } : {}),
        ...(chosen ? { primaryClass: chosen } : {}),
        ...(draft.openAs !== "diagram" ? { previewMode: draft.openAs } : {}),
      },
    };
  },
};
