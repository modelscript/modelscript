// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type { StepSvgPreviewResult } from "./artifact-preprocessor/cad-step-renderer.js";
import { preprocessStepArtifact, renderStepIsometricSvg } from "./artifact-preprocessor/cad-step-renderer.js";
import {
  buildFeaMeshSvgFromDeck,
  preprocessCfdConfigArtifact,
  preprocessFeaDeckArtifact,
  renderCfdConfigIsometricSvg,
} from "./artifact-preprocessor/fea-cfd-renderer.js";
import { tryPreprocessFluidOrProcess } from "./artifact-preprocessor/fluid-process-handlers.js";
import { tryPreprocessMultibodyOrAero } from "./artifact-preprocessor/multibody-aero-handlers.js";
import { preprocessPdfFile } from "./artifact-preprocessor/pdf-preprocessor.js";
import { tryPreprocessPowerOrElectronics } from "./artifact-preprocessor/power-electronics-handlers.js";
import { preprocessSspArtifact } from "./artifact-preprocessor/ssp-preprocessor.js";
import type {
  PreprocessedSysmlConnection,
  PreprocessedSysmlPart,
  PreprocessedSysmlRequirement,
  PreprocessedSysmlStateMachine,
  SysmlConstraintWitness,
} from "./artifact-preprocessor/sysml-preprocessor.js";
import {
  buildSysmlArchitectureFromSource,
  preprocessSysmlArtifact,
} from "./artifact-preprocessor/sysml-preprocessor.js";
import { tryPreprocessSystemsOrIndustrial } from "./artifact-preprocessor/systems-industrial-handlers.js";
import { preprocessTabularArtifact } from "./artifact-preprocessor/tabular-preprocessor.js";
import type { PreprocessContext, PreprocessOptions, PreprocessResult } from "./artifact-preprocessor/types.js";
import { DEFAULT_UPLOAD_DIR } from "./artifact-preprocessor/types.js";
import type { VtuSvgPreviewResult } from "./artifact-preprocessor/vtu-animation-renderer.js";
import {
  preprocessVtuResultArtifact,
  renderCfdAnimationIsometricSvg,
  renderVtuIsometricSvg,
} from "./artifact-preprocessor/vtu-animation-renderer.js";

export type {
  PreprocessedSysmlConnection,
  PreprocessedSysmlPart,
  PreprocessedSysmlRequirement,
  PreprocessedSysmlStateMachine,
  PreprocessOptions,
  PreprocessResult,
  StepSvgPreviewResult,
  SysmlConstraintWitness,
  VtuSvgPreviewResult,
};

export {
  buildFeaMeshSvgFromDeck,
  buildSysmlArchitectureFromSource,
  preprocessPdfFile,
  renderCfdAnimationIsometricSvg,
  renderCfdConfigIsometricSvg,
  renderStepIsometricSvg,
  renderVtuIsometricSvg,
};

const CODE_FALLBACK_EXCLUDED_VIEW_TYPES = new Set([
  "pdf",
  "audio",
  "video",
  "youtube_video",
  "picture",
  "csv",
  "tsv",
  "dataset",
  "dataset-table",
  "json-table",
  "link-preview",
]);

async function dispatchPreprocess(ctx: PreprocessContext): Promise<PreprocessResult | null> {
  switch (ctx.viewType) {
    case "fea-deck":
      return preprocessFeaDeckArtifact(ctx);
    case "cfd-config":
    case "cfd-su2":
      return preprocessCfdConfigArtifact(ctx);
    case "sysml":
    case "sysml2":
      return preprocessSysmlArtifact(ctx);
    case "ssp":
      return preprocessSspArtifact(ctx);
    case "cad":
    case "cad-step":
    case "step":
    case "stp":
      return preprocessStepArtifact(ctx);
    case "simulation-result":
    case "fea-result":
    case "cfd-result":
      return preprocessVtuResultArtifact(ctx);
    case "csv":
    case "tsv":
    case "dataset":
    case "dataset-table":
    case "json-table":
      return preprocessTabularArtifact(ctx);
    default:
      break;
  }

  return (
    (await tryPreprocessPowerOrElectronics(ctx)) ??
    (await tryPreprocessFluidOrProcess(ctx)) ??
    (await tryPreprocessMultibodyOrAero(ctx)) ??
    (await tryPreprocessSystemsOrIndustrial(ctx))
  );
}

/**
 * Server-Side SVG Pre-generation and Metadata Extraction Service (Phase 1.2).
 * Parses uploaded engineering files and produces instant vector SVG diagrams,
 * thumbnails, and domain telemetry for feed rendering without requiring client
 * compilation overhead.
 */
export async function pregenerateServerSvgThumbnail(
  filePath: string,
  viewType: string,
  originalFilename: string,
  uploadDir?: string,
  options: PreprocessOptions = {},
): Promise<PreprocessResult> {
  let result: PreprocessResult = {};

  const resolvedDir = uploadDir ? path.resolve(uploadDir) : DEFAULT_UPLOAD_DIR;
  const safeFilename = path.basename(filePath);
  if (!safeFilename || safeFilename === "." || safeFilename === "..") {
    return result;
  }
  const safeFilePath = path.resolve(resolvedDir, safeFilename);

  if (!safeFilePath.startsWith(resolvedDir + path.sep)) {
    return result;
  }

  if (!fs.existsSync(safeFilePath)) {
    return result;
  }

  if (viewType === "pdf" || safeFilename.toLowerCase().endsWith(".pdf")) {
    return preprocessPdfFile(safeFilePath, originalFilename, resolvedDir);
  }

  let content: string;
  try {
    content = fs.readFileSync(safeFilePath, "utf-8");
  } catch (err) {
    console.warn("[ArtifactPreprocessor] Failed to read file:", safeFilePath, err);
    return result;
  }

  const baseTitle = path.parse(originalFilename).name;
  const inlineCode = content.length <= 250_000 ? content : undefined;

  const ctx: PreprocessContext = {
    safeFilePath,
    resolvedDir,
    originalFilename,
    baseTitle,
    content,
    inlineCode,
    viewType,
    options,
  };

  try {
    const dispatched = await dispatchPreprocess(ctx);
    if (dispatched) {
      result = dispatched;
    }
  } catch (err) {
    console.warn("[ArtifactPreprocessor] Pre-processing failed:", viewType, originalFilename, err);
  }

  // Universal Stage 4 fallback: If no diagram/simulation SVG was produced for a code/model artifact, generate the code editor thumbnail
  if (!result.svg && inlineCode && !CODE_FALLBACK_EXCLUDED_VIEW_TYPES.has(viewType)) {
    try {
      const { renderUniversalCodeThumbnailSvg } = await import("@modelscript/diagram/code-thumbnail-builder");
      result.svg = renderUniversalCodeThumbnailSvg(inlineCode, {
        dialect: viewType,
        title: baseTitle,
      });
      result.metadata = {
        ...(result.metadata || {}),
        previewMode: (result.metadata?.["previewMode"] as string) || "code",
        dialect: (result.metadata?.["dialect"] as string) || viewType,
      };
      result.viewConfigAdditions = {
        ...(result.viewConfigAdditions || {}),
        previewMode: (result.viewConfigAdditions?.["previewMode"] as string) || "code",
        dialect: (result.viewConfigAdditions?.["dialect"] as string) || viewType,
        svg: result.svg,
        code: inlineCode,
        title: baseTitle,
      };
    } catch {
      // Fallback best effort
    }
  }

  // If vector SVG was generated and an upload directory is available, save the thumbnail
  if (result.svg && uploadDir) {
    try {
      const resolvedUploadDir = path.resolve(uploadDir);
      if (!fs.existsSync(resolvedUploadDir)) {
        fs.mkdirSync(resolvedUploadDir, { recursive: true });
      }
      const thumbFilename = `${path.basename(safeFilePath)}.thumb.svg`;
      const thumbPath = path.resolve(resolvedUploadDir, path.basename(thumbFilename));
      if (thumbPath.startsWith(resolvedUploadDir + path.sep) || thumbPath === resolvedUploadDir) {
        fs.writeFileSync(thumbPath, result.svg, "utf-8");
        result.thumbnailUrl = `/api/v1/storage/uploads/${thumbFilename}`;
      }
    } catch (saveErr) {
      console.warn("[ArtifactPreprocessor] Failed to save SVG thumbnail:", originalFilename, saveErr);
    }
  }

  return result;
}
