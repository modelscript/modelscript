// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ASME Y14.5 / ISO 1101 / QIF 3.0 3D GD&T Feature Control Frame & Datum schema
 * and STEP AP242 PMI extractor shared by Docs, Ansatz, and Ansatz 3D viewers.
 */

export type GdtCharacteristicType =
  | "position"
  | "profile_surface"
  | "profile_line"
  | "total_runout"
  | "circular_runout"
  | "concentricity"
  | "perpendicularity"
  | "parallelism"
  | "flatness"
  | "cylindricity"
  | "straightness";

export type GdtMaterialModifier = "RFS" | "MMC" | "LMC";

export interface GdtDatumRef {
  readonly label: string;
  readonly modifier?: GdtMaterialModifier | undefined;
}

export interface GdtCallout3D {
  readonly id: string;
  readonly label: string;
  readonly characteristic: GdtCharacteristicType;
  readonly symbol: string;
  readonly diametrical?: boolean | undefined;
  readonly tolerance: number;
  readonly unit: string;
  readonly materialCondition?: GdtMaterialModifier | undefined;
  readonly datums: readonly GdtDatumRef[];
  readonly anchor: readonly [number, number, number];
  readonly measured?: number | undefined;
  readonly status?: "PASS" | "MARGINAL" | "FAIL" | undefined;
  readonly sourceRef?: string | undefined;
  readonly note?: string | undefined;
}

export interface GdtDatumFeature3D {
  readonly label: string;
  readonly name: string;
  readonly anchor: readonly [number, number, number];
  readonly normal?: readonly [number, number, number] | undefined;
  readonly sourceRef?: string | undefined;
}

export interface GdtOverlayPayload {
  readonly datums: readonly GdtDatumFeature3D[];
  readonly callouts: readonly GdtCallout3D[];
}

export const GDT_CHAR_SYMBOLS: Record<GdtCharacteristicType, string> = {
  position: "⌖",
  profile_surface: "⌓",
  profile_line: "⌒",
  total_runout: "⌰",
  circular_runout: "↗",
  concentricity: "◎",
  perpendicularity: "⊥",
  parallelism: "∥",
  flatness: "⏥",
  cylindricity: "⌭",
  straightness: "⎯",
};

export function formatMaterialModifierGlyph(mod?: GdtMaterialModifier): string {
  if (mod === "MMC") return "Ⓜ";
  if (mod === "LMC") return "Ⓛ";
  return "";
}

/**
 * Formats an ASME Y14.5 Feature Control Frame into a readable ASCII/Unicode box string,
 * e.g. `[⌖ | ⌀0.05 Ⓜ | A | B | C]`.
 */
export function formatFeatureControlFrameText(callout: GdtCallout3D): string {
  const diam = callout.diametrical ? "⌀" : "";
  const mod = formatMaterialModifierGlyph(callout.materialCondition);
  const tolPart = `${diam}${callout.tolerance}${mod ? ` ${mod}` : ""}`;
  const datumParts = callout.datums.map((d) => `${d.label}${formatMaterialModifierGlyph(d.modifier)}`);
  return `[${callout.symbol} | ${tolPart}${datumParts.length > 0 ? ` | ${datumParts.join(" | ")}` : ""}]`;
}

function mapStepTolType(entityType: string): GdtCharacteristicType | null {
  if (entityType.includes("POSITION")) return "position";
  if (entityType.includes("SURFACE_PROFILE")) return "profile_surface";
  if (entityType.includes("LINE_PROFILE")) return "profile_line";
  if (entityType.includes("TOTAL_RUNOUT")) return "total_runout";
  if (entityType.includes("CIRCULAR_RUNOUT") || entityType.includes("RUNOUT")) return "circular_runout";
  if (entityType.includes("CONCENTRICITY") || entityType.includes("COAXIALITY")) return "concentricity";
  if (entityType.includes("PERPENDICULARITY")) return "perpendicularity";
  if (entityType.includes("PARALLELISM")) return "parallelism";
  if (entityType.includes("FLATNESS")) return "flatness";
  if (entityType.includes("CYLINDRICITY")) return "cylindricity";
  if (entityType.includes("STRAIGHTNESS")) return "straightness";
  if (entityType === "GEOMETRIC_TOLERANCE") return "profile_surface";
  return null;
}

/**
 * Parses lightweight QIF 3.0 `CHARACTERISTIC` and `ACTUAL` lines so `extractStepGdtOverlay`
 * can enrich extracted STEP AP242 PMI callouts with live CMM measured deviations and PASS/MARGINAL/FAIL status.
 */
function parseQifActualsSummary(qifText: string): Array<{
  id: string;
  title: string;
  zone?: number;
  actual?: number;
  explicitStatus?: "PASS" | "MARGINAL" | "FAIL";
}> {
  const byId = new Map<
    string,
    { id: string; title: string; zone?: number; actual?: number; explicitStatus?: "PASS" | "MARGINAL" | "FAIL" }
  >();
  for (const rawLine of qifText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;
    if (line.startsWith("CHARACTERISTIC ")) {
      const m = /^CHARACTERISTIC\s+(\S+)\s+\S+\s+"([^"]*)"/.exec(line);
      if (m) {
        const id = m[1]!;
        const title = m[2]!;
        const zm = /\bzone=([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/.exec(line);
        byId.set(id, zm ? { id, title, zone: parseFloat(zm[1]!) } : { id, title });
      }
    } else if (line.startsWith("ACTUAL ")) {
      const charM = /\bcharacteristic=(\S+)/.exec(line);
      const valM = /\bvalue=([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/.exec(line);
      const stM = /\bstatus=(PASS|MARGINAL|FAIL)/i.exec(line);
      const charId = charM?.[1];
      if (charId && byId.has(charId)) {
        const entry = byId.get(charId)!;
        if (valM?.[1]) entry.actual = parseFloat(valM[1]);
        if (stM?.[1]) entry.explicitStatus = stM[1].toUpperCase() as "PASS" | "MARGINAL" | "FAIL";
      }
    }
  }
  return [...byId.values()];
}

/**
 * Extracts ASME Y14.5 datum features and geometric tolerances from a STEP AP242 Part 21 file
 * so CadStepViewer, CadViewer, and docs hero viewports render 3D PMI Feature Control Frames automatically.
 */
export function extractStepGdtOverlay(stepText: string, qifText?: string): GdtOverlayPayload {
  const points = new Map<string, [number, number, number]>();
  const placements = new Map<string, [number, number, number]>();
  const datumFeatures = new Map<string, { label: string; name: string; refs: string[] }>();
  const datumRefs = new Map<string, string>();
  const measureValues = new Map<string, number>();

  const entities: Array<{ id: string; type: string; name: string; args: string; refs: string[] }> = [];
  const stmtRe = /#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = stmtRe.exec(stepText)) !== null) {
    const id = `#${m[1]!}`;
    const type = m[2]!.toUpperCase();
    const args = m[3] ?? "";
    const name = /'([^']*)'/.exec(args)?.[1]?.trim() || type;
    const refs = Array.from(args.matchAll(/#(\d+)/g), (r) => `#${r[1]!}`);
    entities.push({ id, type, name, args, refs });

    if (type === "CARTESIAN_POINT") {
      const coords =
        /\(\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*\)/.exec(
          args,
        );
      if (coords) {
        points.set(id, [parseFloat(coords[1]!), parseFloat(coords[2]!), parseFloat(coords[3]!)]);
      }
    } else if (type === "LENGTH_MEASURE_WITH_UNIT" || type === "MEASURE_WITH_UNIT") {
      const numMatch = /(?:LENGTH_MEASURE|VALUE)\s*\(\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*\)/i.exec(args);
      if (numMatch) {
        measureValues.set(id, parseFloat(numMatch[1]!));
      }
    } else if (type === "DATUM" || type === "DATUM_FEATURE") {
      const labelMatch = /'([A-Z])'/.exec(args) ?? /'([^']{1,4})'/.exec(args);
      const label = labelMatch?.[1]?.trim() || "A";
      datumFeatures.set(id, { label, name, refs });
      datumRefs.set(id, label);
    } else if (type === "DATUM_REFERENCE" || type === "DATUM_REFERENCE_ELEMENT") {
      const labelMatch = /'([A-Z])'/.exec(args);
      if (labelMatch?.[1]) {
        datumRefs.set(id, labelMatch[1]);
      } else {
        for (const r of refs) {
          const existing = datumRefs.get(r);
          if (existing) {
            datumRefs.set(id, existing);
            break;
          }
        }
      }
    }
  }

  for (const ent of entities) {
    if (ent.type === "AXIS2_PLACEMENT_3D") {
      for (const r of ent.refs) {
        const pt = points.get(r);
        if (pt) {
          placements.set(ent.id, pt);
          break;
        }
      }
    }
  }

  const resolveAnchor = (refs: string[], fallbackIdx: number): [number, number, number] => {
    for (const r of refs) {
      const p = placements.get(r) ?? points.get(r);
      if (p) return p;
    }
    const spread = (fallbackIdx - 1) * 0.75;
    return [spread, 0.8 + (fallbackIdx % 2) * 0.25, 0];
  };

  const datums: GdtDatumFeature3D[] = [];
  const seenDatumLabels = new Set<string>();
  let datumIdx = 0;
  for (const [id, d] of datumFeatures) {
    if (seenDatumLabels.has(d.label)) continue;
    seenDatumLabels.add(d.label);
    datums.push({
      label: d.label,
      name: d.name,
      anchor: resolveAnchor(d.refs, datumIdx++),
      sourceRef: id,
    });
  }

  const qifChars = qifText ? parseQifActualsSummary(qifText) : [];
  const callouts: GdtCallout3D[] = [];
  let tolIdx = 0;
  for (const ent of entities) {
    const characteristic = mapStepTolType(ent.type);
    if (!characteristic) continue;

    let tolerance = 0.05;
    for (const r of ent.refs) {
      const val = measureValues.get(r);
      if (val !== undefined) {
        tolerance = val;
        break;
      }
    }
    if (tolerance === 0.05) {
      const inlineNum = /(?:^|[,(])\s*(0\.\d+|[1-9]\d*\.\d+)\s*(?:[,)])/.exec(
        ent.args.replace(/'[^']*'/g, " ").replace(/#\d+/g, " "),
      );
      if (inlineNum?.[1]) {
        tolerance = parseFloat(inlineNum[1]);
      }
    }

    const dRefs: GdtDatumRef[] = [];
    for (const r of ent.refs) {
      const lbl = datumRefs.get(r);
      if (lbl && !dRefs.some((x) => x.label === lbl)) {
        dRefs.push({ label: lbl });
      }
    }

    const hasMmc = /\.MAXIMUM_MATERIAL_CONDITION\.|\bMMC\b/i.test(ent.args);
    const hasLmc = /\.LEAST_MATERIAL_CONDITION\.|\bLMC\b/i.test(ent.args);
    const materialCondition: GdtMaterialModifier | undefined = hasMmc ? "MMC" : hasLmc ? "LMC" : undefined;

    const matchedQif = qifChars.find(
      (q) =>
        ent.args.includes(q.id) ||
        q.title.toLowerCase() === ent.name.toLowerCase() ||
        q.title.replace(/\W+/g, "_").toLowerCase() === ent.name.replace(/\W+/g, "_").toLowerCase(),
    );
    const effectiveTol = matchedQif?.zone ?? tolerance;
    const measured = matchedQif?.actual;
    let status: "PASS" | "MARGINAL" | "FAIL" = "PASS";
    if (measured !== undefined) {
      if (measured > effectiveTol || matchedQif?.explicitStatus === "FAIL") {
        status = "FAIL";
      } else if (measured >= effectiveTol * 0.75 || matchedQif?.explicitStatus === "MARGINAL") {
        status = "MARGINAL";
      }
    }

    callouts.push({
      id: matchedQif ? matchedQif.id : ent.id,
      label: ent.name,
      characteristic,
      symbol: GDT_CHAR_SYMBOLS[characteristic],
      diametrical: characteristic === "position" || characteristic === "concentricity" || /DIAMETER/i.test(ent.args),
      tolerance: effectiveTol,
      unit: "mm",
      materialCondition,
      datums: dRefs,
      anchor: resolveAnchor(ent.refs, tolIdx++),
      measured,
      status,
      sourceRef: matchedQif ? matchedQif.id : ent.id,
    });
  }

  return { datums, callouts };
}
