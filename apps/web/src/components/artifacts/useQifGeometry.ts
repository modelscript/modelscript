// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { getArtifactView } from "../../api";
import { artifactViewTitle, extractArtifactSourceText } from "../compose/attach/artifact-source";
import { type StepGeometry, readGeometryCompanion, stepTextToGeometry } from "./qif-step-geometry";

export type QifGeometryState =
  | { status: "none" }
  | { status: "loading"; title?: string | undefined }
  | { status: "ready"; title?: string | undefined; stepText: string; geometry: StepGeometry | null }
  | { status: "error"; title?: string | undefined; message: string };

interface Resolved {
  key: string;
  state: QifGeometryState;
}

/**
 * Resolves the part geometry for a QIF artifact: a referenced STEP artifact (preferred) or inline
 * legacy `stepCode`/`stepSource`. Never fabricates geometry; with neither it reports `none`.
 */
export function useQifGeometry(
  viewConfig: Record<string, unknown> | null | undefined,
  legacyStepText: string | undefined,
): QifGeometryState {
  const companion = readGeometryCompanion(viewConfig);
  const artifactId = companion ? String(companion.artifactId) : undefined;
  const companionTitle = companion?.title;
  const key = artifactId
    ? `c:${artifactId}`
    : legacyStepText
      ? `l:${legacyStepText.length}:${legacyStepText.slice(0, 48)}`
      : undefined;
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void (async () => {
      let state: QifGeometryState;
      try {
        let stepText = legacyStepText;
        let title = companionTitle;
        if (artifactId) {
          const view: unknown = await getArtifactView(artifactId);
          title = artifactViewTitle(view) ?? companionTitle;
          stepText = await extractArtifactSourceText(view);
        }
        if (!stepText) {
          state = { status: "error", title, message: "The paired STEP model could not be loaded." };
        } else {
          const geometry = await stepTextToGeometry(stepText, title ?? "STEP part");
          state = { status: "ready", title, stepText, geometry };
        }
      } catch (err) {
        state = {
          status: "error",
          title: companionTitle,
          message: err instanceof Error ? err.message : "The paired STEP model could not be loaded.",
        };
      }
      if (!cancelled) setResolved({ key, state });
    })();
    return () => {
      cancelled = true;
    };
  }, [key, artifactId, companionTitle, legacyStepText]);

  if (!key) return { status: "none" };
  return resolved?.key === key ? resolved.state : { status: "loading", title: companionTitle };
}
