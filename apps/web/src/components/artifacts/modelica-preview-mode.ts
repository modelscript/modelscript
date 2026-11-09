// SPDX-License-Identifier: AGPL-3.0-or-later

export type ModelicaPreviewMode = "diagram" | "icon" | "simulation" | "3d" | "code";

export function hasModelica3dVisualizers(code: string): boolean {
  if (!code || typeof code !== "string") return false;
  return (
    /\b(?:Modelica\.Mechanics\.MultiBody\.)?Visualizers\./.test(code) ||
    /\bModelica\.Mechanics\.MultiBody\.(?:Parts|Joints|Forces|World)\b/.test(code) ||
    /\bannotation\s*\([\s\S]*?\b(?:CAD|cad|CADPort)\s*\(/.test(code)
  );
}

export interface ModelicaPreviewMetadata {
  isPartial?: boolean | undefined;
  hasIcon?: boolean | undefined;
  hasDiagram?: boolean | undefined;
  has3d?: boolean | undefined;
  hasEquations?: boolean | undefined;
  hasConnect?: boolean | undefined;
  kind?: string | undefined;
}

export function inferModelicaPreviewMode(
  code: string,
  explicitMode?: string | undefined,
  svg?: string | undefined,
  thumbUrl?: string | undefined,
  modelMetadata?: ModelicaPreviewMetadata | undefined,
): ModelicaPreviewMode {
  // 1. Check if the rendered SVG or thumbnail carries ground-truth preview mode metadata from compiler
  if (svg) {
    const modeMatch = svg.match(/data-preview-mode=["'](diagram|icon|simulation|3d|code)["']/i);
    if (modeMatch && modeMatch[1]) {
      const svgMode = modeMatch[1].toLowerCase() as ModelicaPreviewMode;
      // If no explicit mode, or if explicitMode was defaulted to "diagram" but the actual rendered preview
      // is simulation/icon (e.g. model has no diagram components), honor the rendered SVG mode.
      if (!explicitMode || (explicitMode === "diagram" && svgMode !== "diagram")) {
        return svgMode;
      }
    }
  }
  if (thumbUrl) {
    const thumbMatch = thumbUrl.match(/[._-](diagram|icon|simulation|3d|code)(?:\.thumb)?\.svg/i);
    if (thumbMatch && thumbMatch[1]) {
      const thumbMode = thumbMatch[1].toLowerCase() as ModelicaPreviewMode;
      if (!explicitMode || (explicitMode === "diagram" && thumbMode !== "diagram")) {
        return thumbMode;
      }
    }
  }

  // 2. Explicit preview modes (icon, simulation, 3d, code)
  if (explicitMode === "icon" || explicitMode === "simulation" || explicitMode === "3d" || explicitMode === "code") {
    return explicitMode;
  }
  if (explicitMode === "cad" || explicitMode === "animation" || explicitMode === "3d-animation") {
    return "3d";
  }

  // 3. For explicitMode === "diagram" or unspecified mode, verify against actual AST/code structure
  const has3d = modelMetadata?.has3d !== undefined ? modelMetadata.has3d : hasModelica3dVisualizers(code);
  const hasDiagram =
    modelMetadata?.hasDiagram !== undefined
      ? modelMetadata.hasDiagram
      : /\bPlacement\s*\(/i.test(code) || /\bDiagram\s*\(\s*(?:coordinateSystem[\s\S]*?)?graphics\s*=/i.test(code);
  if (has3d && !hasDiagram) return "3d";
  if (hasDiagram) return "diagram";

  const hasIcon =
    modelMetadata?.hasIcon !== undefined
      ? modelMetadata.hasIcon
      : /\bIcon\s*\(\s*(?:coordinateSystem[\s\S]*?)?graphics\s*=/i.test(code) ||
        /\bextends\s+[A-Za-z0-9_.]*(?:Icon|OnePort|TwoPin|TwoPort|SISO|SO|MI|MO|Interfaces\.)/i.test(code);
  if (hasIcon) return "icon";

  if (has3d) return "3d";

  const isPartial =
    modelMetadata?.isPartial !== undefined
      ? modelMetadata.isPartial
      : /\bpartial\s+(?:encapsulated\s+|expandable\s+)*(?:model|class|block|connector|record|function|package|type|operator)\b/.test(
          code,
        );
  const codeWithoutWithin = code.replace(/^\s*within\b[^;]*;/gm, "");
  const isNonSimKind =
    modelMetadata?.kind !== undefined
      ? ["package", "connector", "record", "function", "type", "operator"].includes(modelMetadata.kind.toLowerCase())
      : /^\s*(?:encapsulated\s+)?(?:package|connector|record|function|type|operator)\b/m.test(codeWithoutWithin);
  const hasEquations =
    modelMetadata?.hasEquations !== undefined
      ? modelMetadata.hasEquations
      : /\b(?:equation|algorithm)\b/.test(code) &&
        (/\bder\s*\(/.test(code) || /(?:^|\n)\s*[A-Za-z0-9_.(),\s+-/*]+\s*:?=\s*[^;=]+;/m.test(code));

  if (!isPartial && !isNonSimKind && hasEquations) {
    return "simulation";
  }
  const hasConnect = modelMetadata?.hasConnect !== undefined ? modelMetadata.hasConnect : /\bconnect\s*\(/i.test(code);
  if (hasConnect) {
    return "diagram";
  }
  if (explicitMode === "diagram") {
    return "diagram";
  }
  return "code";
}
