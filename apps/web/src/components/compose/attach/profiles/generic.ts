// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseBinaryHdf5Buffer } from "../../../../util/tabular-data-parser";
import type { AttachProfile } from "../types";
import { type ArtifactLibraryDependency, detectPolyglotDependencies } from "./dependency-detector";

export interface GenericAttachDraft {
  file: File;
  textSnippet?: string | undefined;
  hdf5Rows?: Record<string, unknown>[] | undefined;
  dependencies?: ArtifactLibraryDependency[] | undefined;
}

const TEXT_DATASET_EXTENSIONS = [".csv", ".tsv", ".json", ".yaml", ".yml", ".xml"];
const HDF5_EXTENSIONS = [".h5", ".hdf5"];

/**
 * Fallback profile: the original single-shot behaviour (upload, let the server preprocess,
 * attach). It has no wizard steps, so files handled by it attach immediately.
 * Languages that need decisions register their own profile instead.
 */
export const genericAttachProfile: AttachProfile<GenericAttachDraft> = {
  id: "generic",
  label: "File",
  fallback: true,
  match: {
    extensions: [
      ".usdz",
      ".usd",
      ".usda",
      ".glb",
      ".gltf",
      ".pdf",
      ".step",
      ".stp",
      ".qif",
      ".csv",
      ".tsv",
      ".json",
      ".yaml",
      ".yml",
      ".h5",
      ".hdf5",
      ".mo",
      ".mos",
      ".sysml",
      ".sysml2",
      ".kerml",
      ".pscx",
      ".pslx",
      ".psout",
      ".raw",
      ".con",
      ".inl",
      ".opi",
      ".key",
      ".tpl",
      ".olga",
      ".ez5",
      ".ezm",
      ".roc",
      ".deck",
      ".lps",
      ".tgx",
      ".sima",
      ".sys",
      ".gtm",
      ".gtd",
      ".inp",
      ".inpt",
      ".bdf",
      ".cfg",
      ".cfgt",
      ".su2",
      ".fmu",
      ".ssp",
      ".ssd",
      ".owl",
      ".ttl",
      ".ofn",
      ".tei",
      ".xml",
    ],
    accept: ["image/*", "video/*", "audio/*"],
  },

  async analyze(file) {
    const lowerName = file.name.toLowerCase();
    const isTextDataset = TEXT_DATASET_EXTENSIONS.some((e) => lowerName.endsWith(e));
    const isHdf5 = HDF5_EXTENSIONS.some((e) => lowerName.endsWith(e));
    const POLYGLOT_CODE_EXTS = [".sysml", ".sysml2", ".kerml", ".cir", ".sp", ".spice", ".va", ".mo", ".mos"];
    const isPolyglotCode = POLYGLOT_CODE_EXTS.some((e) => lowerName.endsWith(e));
    const draft: GenericAttachDraft = { file };

    if ((isTextDataset || isPolyglotCode) && file.size <= 1_500_000 && typeof file.text === "function") {
      try {
        draft.textSnippet = await file.text();
      } catch {
        draft.textSnippet = undefined;
      }
    } else if (isHdf5 && file.size <= 2_500_000 && typeof file.arrayBuffer === "function") {
      try {
        const parsed = parseBinaryHdf5Buffer(await file.arrayBuffer(), file.name);
        if (parsed.rows.length > 0) draft.hdf5Rows = parsed.rows;
      } catch {
        draft.hdf5Rows = undefined;
      }
    }

    const chips: Array<{ label: string; tone?: "neutral" | "success" | "warning" | "error" }> = [];
    if (draft.textSnippet && isPolyglotCode) {
      try {
        const ext = lowerName.slice(lowerName.lastIndexOf("."));
        const deps = await detectPolyglotDependencies(draft.textSnippet, ext);
        if (deps.length > 0) {
          draft.dependencies = deps;
          chips.push({
            label: `${deps.length} external ${deps.length === 1 ? "library" : "libraries"}`,
            tone: "neutral",
          });
        }
      } catch {
        // Non-blocking dependency detection
      }
    }

    return { draft, chips, issues: [] };
  },

  steps: [],

  async build(draft, ctx) {
    const { file } = draft;
    const lowerName = file.name.toLowerCase();
    const uploadData = await ctx.uploadFile(file);

    let artifactType = uploadData.view_type;
    if (!artifactType || artifactType === "other") {
      if (draft.hdf5Rows || HDF5_EXTENSIONS.some((e) => lowerName.endsWith(e))) {
        artifactType = "dataset-table";
      } else if (draft.textSnippet !== undefined || TEXT_DATASET_EXTENSIONS.some((e) => lowerName.endsWith(e))) {
        artifactType = lowerName.endsWith(".json") ? "json-table" : "dataset-table";
      }
    }

    return {
      artifact_type: artifactType ?? "other",
      title: file.name,
      view_config: {
        url: uploadData.url,
        ...(draft.textSnippet ? { rawData: draft.textSnippet, data: draft.textSnippet } : {}),
        ...(draft.hdf5Rows ? { data: draft.hdf5Rows, format: "hdf5" } : {}),
        ...(draft.dependencies && draft.dependencies.length > 0 ? { dependencies: draft.dependencies } : {}),
        ...(uploadData.svg ? { svg: uploadData.svg } : {}),
        ...(uploadData.thumbnail_url ? { thumbnailUrl: uploadData.thumbnail_url } : {}),
        ...(uploadData.view_config_additions || {}),
        ...(uploadData.metadata || {}),
      },
    };
  },
};
