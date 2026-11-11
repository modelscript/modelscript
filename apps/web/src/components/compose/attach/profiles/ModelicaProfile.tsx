// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";
import styledImport from "styled-components";
import { ChoiceCards, IssueList } from "../Primitives";
import type { AttachAnalysis, AttachChip, AttachIssue, AttachProfile, WizardStepProps } from "../types";
import {
  type ArtifactLibraryDependency,
  detectModelicaDependencies,
  findCuratedPackage,
  resolvePackageInfo,
} from "./dependency-detector";
import {
  defaultModelicaClass,
  type ModelicaClassInfo,
  scanModelicaClasses,
  selectableModelicaClasses,
} from "./modelica-classes";

const styled: typeof styledImport = (styledImport as any).default ?? styledImport;

export type ModelicaOpenAs = "diagram" | "simulation" | "code";

export interface ModelicaAttachDraft {
  file: File;
  text: string;
  classes: ModelicaClassInfo[];
  candidates: ModelicaClassInfo[];
  /** Qualified name of the class to showcase. */
  selected?: string | undefined;
  openAs: ModelicaOpenAs;
  /** Configured or detected external package dependencies. */
  dependencies: ArtifactLibraryDependency[];
  /** Edit mode: what the artifact had when it was opened, so `apply` only changes what the user changed. */
  initialSelected?: string | undefined;
  initialOpenAs: ModelicaOpenAs;
  initialDependencies?: ArtifactLibraryDependency[] | undefined;
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

const DepList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
  padding: 2px;
`;

const DepRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--ms-border);
  background: var(--ms-surface-hover, rgba(255, 255, 255, 0.04));
`;

const DepInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
`;

const DepHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const DepName = styled.span`
  font-weight: 600;
  font-size: 13px;
  color: var(--ms-text-1);
`;

const DepBadge = styled.span<{ $detected?: boolean }>`
  font-size: 10px;
  line-height: 14px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
  background: ${(p) => (p.$detected ? "rgba(59, 130, 246, 0.15)" : "rgba(16, 185, 129, 0.15)")};
  color: ${(p) => (p.$detected ? "#60a5fa" : "#34d399")};
  border: 1px solid ${(p) => (p.$detected ? "rgba(59, 130, 246, 0.3)" : "rgba(16, 185, 129, 0.3)")};
`;

const DepDescription = styled.span`
  font-size: 11px;
  color: var(--ms-text-3, var(--ms-text-2));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const DepActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const VersionSelect = styled.select`
  height: 26px;
  padding: 0 6px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  border: 1px solid var(--ms-border-strong, var(--ms-border));
  background: var(--ms-surface, #0d1117);
  color: var(--ms-text-1);
  cursor: pointer;

  &:focus {
    outline: 2px solid var(--ms-brand, #3b82f6);
  }
`;

const RemoveButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ms-text-3, var(--ms-text-2));
  cursor: pointer;
  font-size: 14px;

  &:hover {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
  }
`;

const AddDepForm = styled.form`
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
`;

const AddInput = styled.input`
  flex: 1;
  height: 30px;
  padding: 0 10px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--ms-border);
  background: var(--ms-surface, #0d1117);
  color: var(--ms-text-1);

  &:focus {
    outline: 2px solid var(--ms-brand, #3b82f6);
  }
`;

const AddButton = styled.button`
  height: 30px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid var(--ms-border-strong, var(--ms-border));
  background: var(--ms-surface-hover, transparent);
  color: var(--ms-text-1);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--ms-brand, #3b82f6);
    color: #ffffff;
    border-color: var(--ms-brand, #3b82f6);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const EmptyNotice = styled.div`
  padding: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--ms-text-3, var(--ms-text-2));
  border: 1px dashed var(--ms-border);
  border-radius: 8px;
`;

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

const DependenciesStep: React.FC<WizardStepProps<ModelicaAttachDraft>> = ({ draft, update, issues }) => {
  const [newPkgName, setNewPkgName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleRemove = (nameToRemove: string) => {
    const next = draft.dependencies.filter((d) => d.name.toLowerCase() !== nameToRemove.toLowerCase());
    update({ dependencies: next });
  };

  const handleVersionChange = (name: string, newVersion: string) => {
    const next = draft.dependencies.map((d) =>
      d.name.toLowerCase() === name.toLowerCase() ? { ...d, version: newVersion } : d,
    );
    update({ dependencies: next });
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newPkgName.trim();
    if (!clean) return;

    if (draft.dependencies.some((d) => d.name.toLowerCase() === clean.toLowerCase())) {
      setNewPkgName("");
      return;
    }

    setIsAdding(true);
    try {
      const curated = findCuratedPackage(clean);
      const info = await resolvePackageInfo(clean);
      const newDep: ArtifactLibraryDependency = {
        name: curated?.name ?? clean,
        version: info.version,
        autoDetected: false,
        resolvedFrom: "user-specified",
        description: info.description,
        verified: info.verified,
        availableVersions: info.versions,
      };
      update({ dependencies: [...draft.dependencies, newDep] });
      setNewPkgName("");
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <>
      {draft.dependencies.length > 0 ? (
        <DepList>
          {draft.dependencies.map((dep) => {
            const versions =
              dep.availableVersions && dep.availableVersions.length > 0 ? dep.availableVersions : [dep.version];
            return (
              <DepRow key={dep.name}>
                <DepInfo>
                  <DepHeader>
                    <DepName>{dep.name}</DepName>
                    <DepBadge $detected={dep.autoDetected}>
                      {dep.autoDetected ? "Auto-detected" : "User-added"}
                    </DepBadge>
                  </DepHeader>
                  {dep.description && <DepDescription title={dep.description}>{dep.description}</DepDescription>}
                </DepInfo>
                <DepActions>
                  <VersionSelect
                    value={dep.version}
                    onChange={(e) => handleVersionChange(dep.name, e.target.value)}
                    aria-label={`Version for ${dep.name}`}
                  >
                    {versions.map((ver) => (
                      <option key={ver} value={ver}>
                        v{ver}
                      </option>
                    ))}
                  </VersionSelect>
                  <RemoveButton
                    type="button"
                    onClick={() => handleRemove(dep.name)}
                    aria-label={`Remove ${dep.name}`}
                    title="Remove dependency"
                  >
                    ✕
                  </RemoveButton>
                </DepActions>
              </DepRow>
            );
          })}
        </DepList>
      ) : (
        <EmptyNotice>
          No external library dependencies configured. This model will use standard built-in Modelica libraries.
        </EmptyNotice>
      )}

      <AddDepForm onSubmit={handleAdd}>
        <AddInput
          type="text"
          placeholder="Add package (e.g. Buildings, PlanarMechanics)..."
          value={newPkgName}
          onChange={(e) => setNewPkgName(e.target.value)}
          aria-label="Add package name"
        />
        <AddButton type="submit" disabled={!newPkgName.trim() || isAdding}>
          {isAdding ? "Adding…" : "Add Library"}
        </AddButton>
      </AddDepForm>

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

    const declaredNames = classes.map((c) => c.name);
    const dependencies = await detectModelicaDependencies(text, declaredNames);
    if (dependencies.length > 0) {
      chips.push({
        label: `${dependencies.length} external ${dependencies.length === 1 ? "library" : "libraries"}`,
        tone: "neutral",
      });
    }

    const draft: ModelicaAttachDraft = {
      file,
      text,
      classes,
      candidates,
      selected: defaultModelicaClass(candidates)?.qualifiedName,
      openAs: "diagram",
      dependencies,
      initialOpenAs: "diagram",
      initialDependencies: dependencies,
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
    {
      id: "dependencies",
      title: "External Libraries",
      description: "Confirm or customize the packages required to simulate and render this model.",
      when: (d) => d.dependencies.length > 0,
      Component: DependenciesStep,
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

      const storedDeps: ArtifactLibraryDependency[] = Array.isArray(config["dependencies"])
        ? (config["dependencies"] as ArtifactLibraryDependency[])
        : analysis.draft.dependencies;

      analysis.draft = {
        ...analysis.draft,
        selected,
        openAs,
        dependencies: storedDeps,
        initialSelected: selected,
        initialOpenAs: openAs,
        initialDependencies: storedDeps,
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
      if (draft.dependencies !== draft.initialDependencies) patch["dependencies"] = draft.dependencies;
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
        ...(draft.dependencies && draft.dependencies.length > 0 ? { dependencies: draft.dependencies } : {}),
      },
    };
  },
};
