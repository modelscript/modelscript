// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createCanonicalPolyglotDemoBoard,
  deserializeCanvasDocument,
  validateCanvasDocument,
  type CanvasDocument,
  type SurfacePresentationMode,
} from "@modelscript/canvas";
import {
  buildRotundaCanvasDocument,
  ROTUNDA_ENVIRONMENTS,
  type BuildRotundaBoardOptions,
  type RotundaEnvironmentId,
} from "@modelscript/rotunda/types.js";
import { parseModelicaParameters } from "../../util/modelica-params";

const VALID_ENVIRONMENTS = new Set<string>(ROTUNDA_ENVIRONMENTS.map((env) => env.id));
const VALID_SURFACE_MODES = new Set<string>(["desktop-2d", "spatial-3d", "webxr-vr"]);

const INDUSTRIAL_ARTIFACT_PATTERN =
  /(?:^|[\s._/-])(cad|cad3d|step|stp|fea|cfd|gcode|g-code|nc|vtk|vtu|vtp|stl|obj|iges|igs|dxf|scad|usd|mesh|3d-cad)(?:$|[\s._/-])/i;

/**
 * Chooses a bright default VR Rotunda environment for an artifact when no explicit
 * environment is specified: `"warehouse"` (Factory floor) for CAD/STEP/FEA/CFD/GCode
 * mechanical artifacts, and `"atrium"` (Future Atrium hero environment) otherwise.
 */
export function resolveDefaultArtifactEnvironment(
  viewType?: string | null | undefined,
  viewConfig?: Record<string, unknown> | null | undefined,
): RotundaEnvironmentId {
  const candidates: string[] = [];
  if (typeof viewType === "string" && viewType.trim()) {
    candidates.push(viewType.trim());
  }
  if (viewConfig) {
    for (const key of ["dialect", "language", "filename", "artifactUri", "url"] as const) {
      const raw = viewConfig[key];
      if (typeof raw === "string" && raw.trim()) {
        candidates.push(raw.trim());
      }
    }
  }
  for (const token of candidates) {
    if (INDUSTRIAL_ARTIFACT_PATTERN.test(token)) {
      return "warehouse";
    }
  }
  return "atrium";
}

/** Validates an untrusted string into a supported `RotundaEnvironmentId`, falling back cleanly. */
export function parseRotundaEnvironmentId(
  raw: unknown,
  fallback: RotundaEnvironmentId = "atrium",
): RotundaEnvironmentId {
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (VALID_ENVIRONMENTS.has(normalized)) {
      return normalized as RotundaEnvironmentId;
    }
  }
  return fallback;
}

/** Validates an untrusted string into a supported `SurfacePresentationMode`, falling back cleanly. */
export function parseSurfacePresentationMode(
  raw: unknown,
  fallback: SurfacePresentationMode = "desktop-2d",
): SurfacePresentationMode {
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (VALID_SURFACE_MODES.has(normalized)) {
      return normalized as SurfacePresentationMode;
    }
  }
  return fallback;
}

/**
 * Attempts to coerce an inline candidate (`CanvasDocument` object or `.mscanvas` JSON string)
 * into a validated `CanvasDocument`. Returns `null` if invalid.
 */
export function tryParseCanvasDocument(candidate: unknown): CanvasDocument | null {
  if (!candidate) return null;
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (!trimmed.startsWith("{")) return null;
    try {
      return deserializeCanvasDocument(trimmed);
    } catch {
      return null;
    }
  }
  if (typeof candidate === "object") {
    const issues = validateCanvasDocument(candidate);
    if (issues.length === 0) {
      return candidate as CanvasDocument;
    }
  }
  return null;
}

/**
 * Resolves a `CanvasDocument` synchronously from `viewConfig.document`, `viewConfig.canvas`,
 * or `viewConfig.code` (via `deserializeCanvasDocument`). Returns `null` if none are valid.
 */
export function resolveInlineCanvasDocument(
  viewConfig: Record<string, unknown> | null | undefined,
): CanvasDocument | null {
  if (!viewConfig) return null;
  return (
    tryParseCanvasDocument(viewConfig["document"]) ??
    tryParseCanvasDocument(viewConfig["canvas"]) ??
    tryParseCanvasDocument(viewConfig["code"])
  );
}

/** Extracts normalized `{ name, value, unit? }` parameter rows from `viewConfig.parameters` and Modelica `code`. */
export function extractArtifactRotundaParameters(
  viewConfig: Record<string, unknown> | null | undefined,
): Array<{ name: string; value: string | number; unit?: string | undefined }> {
  const out: Array<{ name: string; value: string | number; unit?: string | undefined }> = [];
  const seen = new Set<string>();

  const pushParam = (name: string, value: string | number, unit?: string) => {
    const cleanName = name.trim();
    if (!cleanName || seen.has(cleanName)) return;
    seen.add(cleanName);
    out.push(unit ? { name: cleanName, value, unit } : { name: cleanName, value });
  };

  const rawParams = viewConfig?.["parameters"];
  if (Array.isArray(rawParams)) {
    for (const item of rawParams) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const name = typeof rec["name"] === "string" ? rec["name"] : typeof rec["key"] === "string" ? rec["key"] : "";
      const rawVal = rec["value"] ?? rec["default"] ?? rec["defaultValue"];
      const unit = typeof rec["unit"] === "string" && rec["unit"].trim() ? rec["unit"].trim() : undefined;
      if (name && (typeof rawVal === "string" || typeof rawVal === "number")) {
        pushParam(name, rawVal, unit);
      }
    }
  } else if (rawParams && typeof rawParams === "object") {
    for (const [k, v] of Object.entries(rawParams as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number") {
        pushParam(k, v);
      }
    }
  }

  const code = viewConfig?.["code"];
  if (typeof code === "string" && code.trim().length > 0) {
    const parsed = parseModelicaParameters(code);
    for (const [k, v] of Object.entries(parsed)) {
      pushParam(k, v);
    }
  }

  return out;
}

/**
 * Builds a `CanvasDocument` suitable for hosting an arbitrary artifact inside the
 * Engineering Rotunda VR workstation. If the artifact already carries a valid `.mscanvas`
 * document, it is preserved verbatim; otherwise a cohesive 4-tile board is synthesized.
 */
export function buildArtifactRotundaDocument(input: {
  title?: string | undefined;
  viewType?: string | undefined;
  viewConfig?: Record<string, unknown> | null | undefined;
  artifactId?: number | string | undefined;
}): CanvasDocument {
  const inlineDoc = resolveInlineCanvasDocument(input.viewConfig);
  if (inlineDoc) return inlineDoc;

  const vc = input.viewConfig ?? {};
  const title =
    (typeof input.title === "string" && input.title.trim()) ||
    (typeof vc["title"] === "string" && vc["title"].trim()) ||
    (input.artifactId ? `Artifact #${input.artifactId}` : "Engineering Artifact");

  const languageId =
    (typeof vc["dialect"] === "string" && vc["dialect"].trim()) ||
    (typeof vc["language"] === "string" && vc["language"].trim()) ||
    (typeof input.viewType === "string" && input.viewType.trim()) ||
    "modelica";

  const artifactUri =
    (typeof vc["url"] === "string" && vc["url"].trim()) ||
    (typeof vc["artifactUri"] === "string" && vc["artifactUri"].trim()) ||
    (typeof vc["filename"] === "string" && vc["filename"].trim()) ||
    undefined;

  const rawDiagram = vc["diagramData"] ?? vc["diagram"];
  const diagramData =
    rawDiagram && typeof rawDiagram === "object" && !Array.isArray(rawDiagram)
      ? (rawDiagram as Record<string, unknown>)
      : undefined;

  const parameters = extractArtifactRotundaParameters(vc);

  const opts: BuildRotundaBoardOptions = {
    title,
    languageId,
    ...(artifactUri ? { artifactUri } : {}),
    ...(diagramData ? { diagramData } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
  };

  try {
    return buildRotundaCanvasDocument(opts);
  } catch {
    return createCanonicalPolyglotDemoBoard();
  }
}
