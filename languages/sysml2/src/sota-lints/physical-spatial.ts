// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LintResult } from "@modelscript/dsl";
import {
  CausalizationTheoryOracle,
  computeRcc8Relation,
  SpatialPhysicsOracle,
  type CadBoundingBox,
  type QueryDB,
  type SymbolEntry,
} from "@modelscript/runtime";
import {
  collectCstLeaves,
  findFirstDescendant,
  getCstChildren,
  isSysmlIdentLeaf,
  parseSignedNumberFromLeaves,
  readDottedChainFromLeaves,
} from "../cst-utils.js";
import { SysML2ErrorCode } from "../errors.js";
import { getFeatureValue, resolveFeatureInScope, resolveTypeOf } from "../queries.js";
import { normalizeTypeName, resolvePathInScope } from "../type-checker.js";
import { collectOwnExpressionSubtrees } from "./behavioral-modifiers.js";
import { extractBindingEndpoints, extractFlowEndpointsFast, isUserWorkspaceSymbol } from "./formal-verification.js";
import {
  evalSequenceIndexInterval,
  extractConnectionEndpointsFast,
  extractMetadataTypeName,
  resolveSequenceMultiplicity,
} from "./hygiene-metadata.js";
import {
  cstHasError,
  emitDiag,
  extractSpecializationClauses,
  getSymbolCst,
  getSymbolLeavesFast,
  hasHeaderKeyword,
  isTruthyMeta,
} from "./shared.js";

/**
 * Validates S6021 (`sequence-index-out-of-bounds`) on 1-based KerML `seq#(idx)` expressions.
 */
export function checkSequenceIndexBounds(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  const { node: cst, baseOffset } = getSymbolCst(db, self);
  if (!cst || cstHasError(cst)) return null;

  const evalScopeId = self.kind === "Definition" || self.kind === "Package" ? self.id : (self.parentId ?? self.id);
  const primNodes = collectOwnExpressionSubtrees(db, self, cst, baseOffset, new Set(["PrimaryExpression"]));
  if (primNodes.length === 0) return null;

  const diagnostics: LintResult[] = [];

  for (const prim of primNodes) {
    const chs = getCstChildren(prim);
    const hashIdx = chs.findIndex((c) => c.type === "#" || c.text === "#");
    const indexOperand =
      prim.childForFieldName?.("indexOperand") ??
      (hashIdx !== -1
        ? chs.slice(hashIdx + 1).find((c) => c.type === "SequenceExpression" || c.type === "OwnedExpression")
        : null);
    if (!indexOperand) continue;

    // Extract sequence target path preceding `#(`
    const primLeaves = collectCstLeaves(prim);
    const hashLeafIdx = primLeaves.findIndex((l) => l.text === "#");
    if (hashLeafIdx <= 0 || primLeaves[hashLeafIdx + 1]?.text !== "(") continue;
    const seqChain = readDottedChainFromLeaves(primLeaves, 0);
    const seqPath =
      seqChain && seqChain.nextIdx <= hashLeafIdx
        ? seqChain.text
        : primLeaves
            .slice(0, hashLeafIdx)
            .map((l) => l.text)
            .join("");
    if (!seqPath) continue;

    const seqSym = resolvePathInScope(db, evalScopeId, seqPath) ?? resolveFeatureInScope(db, evalScopeId, seqPath);
    const mult = resolveSequenceMultiplicity(db, seqSym);

    const iv = evalSequenceIndexInterval(db, indexOperand, self, evalScopeId);
    if (iv.isBottom() || iv.isTop()) continue;

    const fmtNum = (n: number) =>
      !Number.isFinite(n)
        ? n > 0
          ? "*"
          : "-Infinity"
        : Number.isInteger(n)
          ? String(n)
          : Number(n.toFixed(4)).toString();
    const indexDesc = iv.low === iv.high ? fmtNum(iv.low) : `[${fmtNum(iv.low)}, ${fmtNum(iv.high)}]`;
    const upperBoundLabel = mult && Number.isFinite(mult.upper) ? String(mult.upper) : "*";
    const boundsDesc = `valid 1-based range is 1..${upperBoundLabel}`;

    if (iv.high < 1) {
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.SEQUENCE_INDEX_OUT_OF_BOUNDS, [seqPath, indexDesc, boundsDesc], {
          node: indexOperand,
          baseOffset,
        }),
      );
    } else if (mult && Number.isFinite(mult.upper) && iv.low > mult.upper) {
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.SEQUENCE_INDEX_OUT_OF_BOUNDS, [seqPath, indexDesc, boundsDesc], {
          node: indexOperand,
          baseOffset,
        }),
      );
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S6033: Cyber-Physical Nyquist & Sampling Stability (`CausalizationTheoryOracle`)
// ---------------------------------------------------------------------------

const CONTROLLER_PERIOD_ATTRS = new Set<string>(["sampleperiod", "samplingperiod", "dt", "controlperiod", "stepsize"]);

const CONTROLLER_FREQ_ATTRS = new Set<string>([
  "samplerate",
  "samplingrate",
  "samplingfrequency",
  "samplefrequency",
  "controlrate",
  "looprate",
]);

const PLANT_BANDWIDTH_ATTRS = new Set<string>([
  "bandwidth",
  "cutofffrequency",
  "maxfrequency",
  "signalbandwidth",
  "nyquistbandwidth",
]);

const PLANT_POLE_ATTRS = new Set<string>(["polefrequency", "dominantpolefrequency", "naturalfrequency"]);

const PLANT_TAU_ATTRS = new Set<string>(["timeconstant", "tau"]);

function extractFeatureScalarWithUnit(
  db: QueryDB,
  featSym: SymbolEntry,
  scopeId: number | null,
): { value: number; unit: string } | null {
  const val = getFeatureValue(db, featSym, scopeId);
  if (typeof val !== "number" || !Number.isFinite(val)) return null;
  let unit = "";
  const { node } = getSymbolCst(db, featSym);
  if (node) {
    const meas = findFirstDescendant(node, "MeasurementExpression");
    if (meas) {
      unit = meas.childForFieldName?.("unit")?.text?.trim() ?? "";
    }
  }
  if (!unit) {
    const { leaves } = getSymbolLeavesFast(db, featSym);
    for (let i = 0; i < leaves.length - 2; i++) {
      if (leaves[i]!.text === "[" && leaves[i + 2]?.text === "]") {
        unit = leaves[i + 1]!.text;
      }
    }
  }
  return { value: val, unit };
}

function toSeconds(value: number, unit: string): number {
  const u = unit.trim();
  if (u === "ms") return value * 1e-3;
  if (u === "us" || u === "µs") return value * 1e-6;
  if (u === "ns") return value * 1e-9;
  if (u === "min") return value * 60;
  return value;
}

function toHertz(value: number, unit: string): number {
  const u = unit.trim();
  if (u === "kHz") return value * 1e3;
  if (u === "MHz") return value * 1e6;
  if (u === "mHz") return value * 1e-3;
  return value;
}

function extractControllerSamplingHz(db: QueryDB, sym: SymbolEntry): { fsHz: number; sourceDesc: string } | null {
  const inspectSingle = (target: SymbolEntry): { fsHz: number; sourceDesc: string } | null => {
    for (const ch of db.childrenOf(target.id)) {
      if (ch.kind !== "Usage") continue;
      let nm = ch.name && ch.name !== "<anonymous>" ? ch.name : "";
      if (!nm) {
        const cls = extractSpecializationClauses(db, ch);
        if (cls.length > 0) nm = cls[0]!.targetPath.split(".").pop()!;
      }
      const low = nm.toLowerCase();
      if (CONTROLLER_PERIOD_ATTRS.has(low)) {
        const parsed = extractFeatureScalarWithUnit(db, ch, target.id);
        if (parsed && parsed.value > 0) {
          const tsSec = toSeconds(parsed.value, parsed.unit);
          if (tsSec > 0) {
            return {
              fsHz: 1.0 / tsSec,
              sourceDesc: `${nm} = ${parsed.value}${parsed.unit ? ` [${parsed.unit}]` : ""}`,
            };
          }
        }
      } else if (CONTROLLER_FREQ_ATTRS.has(low)) {
        const parsed = extractFeatureScalarWithUnit(db, ch, target.id);
        if (parsed && parsed.value > 0) {
          return {
            fsHz: toHertz(parsed.value, parsed.unit),
            sourceDesc: `${nm} = ${parsed.value}${parsed.unit ? ` [${parsed.unit}]` : ""}`,
          };
        }
      }
    }

    // Periodic `after <T_s> [s|ms]` trigger inside TransitionUsage / AcceptActionNode
    for (const ch of db.childrenOf(target.id)) {
      if (ch.ruleName !== "TransitionUsage" && ch.ruleName !== "AcceptActionNode") continue;
      const { leaves } = getSymbolLeavesFast(db, ch);
      for (let i = 0; i < leaves.length - 1; i++) {
        if (leaves[i]!.text !== "after") continue;
        const num = parseSignedNumberFromLeaves(leaves, i + 1);
        if (num && num.value > 0) {
          let unit = "";
          if (leaves[num.nextIdx]?.text === "[" && leaves[num.nextIdx + 2]?.text === "]") {
            unit = leaves[num.nextIdx + 1]!.text;
          }
          const tsSec = toSeconds(num.value, unit);
          if (tsSec > 0) {
            return { fsHz: 1.0 / tsSec, sourceDesc: `after ${num.value}${unit ? ` [${unit}]` : ""}` };
          }
        }
      }
    }

    // Also inspect owned `exhibit state` / `perform action` / `state` / `action` children
    for (const ch of db.childrenOf(target.id)) {
      if (
        ch.ruleName === "StateUsage" ||
        ch.ruleName === "ExhibitStateUsage" ||
        ch.ruleName === "ActionUsage" ||
        ch.ruleName === "PerformActionUsage"
      ) {
        const subHit = extractControllerSamplingHz(db, ch);
        if (subHit) return subHit;
      }
    }

    return null;
  };

  const direct = inspectSingle(sym);
  if (direct) return direct;
  const tSym = resolveTypeOf(db, sym);
  if (tSym && isUserWorkspaceSymbol(tSym) && tSym.id !== sym.id) {
    return inspectSingle(tSym);
  }
  return null;
}

interface PlantDynamicsRequirement {
  minSamplingHz: number;
  strictGreater: boolean;
  oraclePoleHz: number;
  detail: string;
}

function extractPlantDynamicsDemand(db: QueryDB, sym: SymbolEntry): PlantDynamicsRequirement | null {
  const inspectSingle = (target: SymbolEntry): PlantDynamicsRequirement | null => {
    for (const ch of db.childrenOf(target.id)) {
      if (ch.kind !== "Usage") continue;
      let nm = ch.name && ch.name !== "<anonymous>" ? ch.name : "";
      if (!nm) {
        const cls = extractSpecializationClauses(db, ch);
        if (cls.length > 0) nm = cls[0]!.targetPath.split(".").pop()!;
      }
      const low = nm.toLowerCase();
      if (PLANT_BANDWIDTH_ATTRS.has(low)) {
        const parsed = extractFeatureScalarWithUnit(db, ch, target.id);
        if (parsed && parsed.value > 0) {
          const fMax = toHertz(parsed.value, parsed.unit);
          return {
            minSamplingHz: 2.0 * fMax,
            strictGreater: true,
            oraclePoleHz: 0.2 * fMax,
            detail: `Nyquist limit > 2 * ${nm} (${fMax.toFixed(2)} Hz)`,
          };
        }
      } else if (PLANT_POLE_ATTRS.has(low)) {
        const parsed = extractFeatureScalarWithUnit(db, ch, target.id);
        if (parsed && parsed.value > 0) {
          const fPole = toHertz(parsed.value, parsed.unit);
          return {
            minSamplingHz: 5.0 * fPole,
            strictGreater: false,
            oraclePoleHz: fPole,
            detail: `5x dominant pole ${nm} (${fPole.toFixed(2)} Hz)`,
          };
        }
      } else if (PLANT_TAU_ATTRS.has(low)) {
        const parsed = extractFeatureScalarWithUnit(db, ch, target.id);
        if (parsed && parsed.value > 0) {
          const tauSec = toSeconds(parsed.value, parsed.unit);
          if (tauSec > 0) {
            const fPole = 1.0 / (2.0 * Math.PI * tauSec);
            return {
              minSamplingHz: 5.0 * fPole,
              strictGreater: false,
              oraclePoleHz: fPole,
              detail: `timeConstant ${tauSec}s -> f_pole = ${fPole.toFixed(2)} Hz`,
            };
          }
        }
      }
    }
    return null;
  };

  const direct = inspectSingle(sym);
  if (direct) return direct;
  const tSym = resolveTypeOf(db, sym);
  if (tSym && isUserWorkspaceSymbol(tSym) && tSym.id !== sym.id) {
    return inspectSingle(tSym);
  }
  return null;
}

/**
 * Validates S6033 (`cyber-physical-nyquist-violation`) using `CausalizationTheoryOracle`
 * and Nyquist-Shannon / pole-discretization criteria.
 */
export function checkCyberPhysicalNyquist(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  if (!isUserWorkspaceSymbol(self)) return null;
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const fmtHz = (n: number) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(2)).toString());
  const diagnostics: LintResult[] = [];

  const verifyLoopPair = (
    ctrlSym: SymbolEntry,
    ctrlInfo: { fsHz: number; sourceDesc: string },
    plantInfo: PlantDynamicsRequirement,
    targetSym: SymbolEntry | null,
  ) => {
    const oracle = new CausalizationTheoryOracle();
    const loopId = `${ctrlSym.name || "controller"}_loop`;
    oracle.assertLiteral({
      id: 1,
      predicate: "sampleRate",
      args: [loopId, ctrlInfo.fsHz, plantInfo.oraclePoleHz],
    });
    const oracleRes = oracle.checkSat();

    const nyquistViolated = plantInfo.strictGreater
      ? ctrlInfo.fsHz <= plantInfo.minSamplingHz + 1e-9
      : ctrlInfo.fsHz < plantInfo.minSamplingHz - 1e-9;

    if (nyquistViolated && (!oracleRes.isSat || nyquistViolated)) {
      const ctrlLabel = ctrlSym.name || self.name || ctrlSym.ruleName;
      const reqStr = plantInfo.strictGreater ? `> ${fmtHz(plantInfo.minSamplingHz)}` : fmtHz(plantInfo.minSamplingHz);
      diagnostics.push(
        emitDiag(
          db,
          self,
          SysML2ErrorCode.CYBER_PHYSICAL_NYQUIST_VIOLATION,
          [ctrlLabel, fmtHz(ctrlInfo.fsHz), reqStr, `${ctrlInfo.sourceDesc}; ${plantInfo.detail}`],
          targetSym,
        ),
      );
    }
  };

  // 1. Composite container (`PartDefinition`, `PartUsage`, `Package`) pairing discrete controllers & plants
  if (
    self.ruleName === "PartDefinition" ||
    self.ruleName === "PartUsage" ||
    self.ruleName === "Package" ||
    self.ruleName === "LibraryPackage"
  ) {
    const children = db.childrenOf(self.id);
    const subComponents = children.filter(
      (c) =>
        c.kind === "Usage" &&
        (c.ruleName === "PartUsage" ||
          c.ruleName === "ActionUsage" ||
          c.ruleName === "PerformActionUsage" ||
          c.ruleName === "StateUsage" ||
          c.ruleName === "ExhibitStateUsage"),
    );

    if (subComponents.length >= 2) {
      const ctrls: Array<{ sym: SymbolEntry; info: { fsHz: number; sourceDesc: string } }> = [];
      const plants: Array<{ sym: SymbolEntry; info: PlantDynamicsRequirement }> = [];
      for (const sc of subComponents) {
        const cInfo = extractControllerSamplingHz(db, sc);
        if (cInfo) ctrls.push({ sym: sc, info: cInfo });
        const pInfo = extractPlantDynamicsDemand(db, sc);
        if (pInfo) plants.push({ sym: sc, info: pInfo });
      }

      if (ctrls.length > 0 && plants.length > 0) {
        // Build explicit connection/flow/allocation adjacency if in Package; in PartDefinition/PartUsage colocation also suffices
        const linkedPairs = new Set<string>();
        for (const ch of children) {
          if (ch.ruleName === "ConnectionUsage") {
            const ep = extractConnectionEndpointsFast(db, ch);
            if (ep) {
              const a = ep.source.split(".")[0]!;
              const b = ep.target.split(".")[0]!;
              linkedPairs.add(`${a}<->${b}`);
              linkedPairs.add(`${b}<->${a}`);
            }
          } else if (ch.ruleName === "FlowUsage" || ch.ruleName === "SuccessionFlowUsage") {
            const ep = extractFlowEndpointsFast(db, ch);
            if (ep) {
              const a = ep.source.split(".")[0]!;
              const b = ep.target.split(".")[0]!;
              linkedPairs.add(`${a}<->${b}`);
              linkedPairs.add(`${b}<->${a}`);
            }
          } else if (ch.ruleName === "AllocationUsage") {
            const refs = db.childrenOf(ch.id).filter((r) => r.kind === "Reference");
            if (refs.length >= 2) {
              const a = (refs[0]!.name || "").split(".")[0]!;
              const b = (refs[1]!.name || "").split(".")[0]!;
              linkedPairs.add(`${a}<->${b}`);
              linkedPairs.add(`${b}<->${a}`);
            }
          } else if (ch.ruleName === "BindingConnectorAsUsage") {
            const pair = extractBindingEndpoints(db, ch);
            if (pair) {
              const a = pair[0].split(".")[0]!;
              const b = pair[1].split(".")[0]!;
              linkedPairs.add(`${a}<->${b}`);
              linkedPairs.add(`${b}<->${a}`);
            }
          }
        }

        const isColocatedComposite = self.ruleName === "PartDefinition" || self.ruleName === "PartUsage";
        const flaggedCtrls = new Set<number>();

        for (const ctrl of ctrls) {
          if (flaggedCtrls.has(ctrl.sym.id)) continue;
          for (const plant of plants) {
            if (ctrl.sym.id === plant.sym.id) continue;
            const pairKey = `${ctrl.sym.name || ""}<->${plant.sym.name || ""}`;
            if (!isColocatedComposite && !linkedPairs.has(pairKey)) continue;
            const prevLen = diagnostics.length;
            verifyLoopPair(ctrl.sym, ctrl.info, plant.info, ctrl.sym);
            if (diagnostics.length > prevLen) {
              flaggedCtrls.add(ctrl.sym.id);
              break;
            }
          }
        }
      }
    }
  }

  // 2. Self-contained controller+plant declaration on a single Definition (without child PartUsages)
  if (
    diagnostics.length === 0 &&
    (self.ruleName === "PartDefinition" || self.ruleName === "ActionDefinition" || self.ruleName === "StateDefinition")
  ) {
    const selfCtrl = extractControllerSamplingHz(db, self);
    const selfPlant = extractPlantDynamicsDemand(db, self);
    if (selfCtrl && selfPlant) {
      verifyLoopPair(self, selfCtrl, selfPlant, null);
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S6042: 3D RCC-8 Spatial Envelope Clash, Protrusion & Max Wire Length
// ---------------------------------------------------------------------------

function parseMetadataNumericFields(db: QueryDB, metaSym: SymbolEntry): Map<string, number> {
  const fields = new Map<string, number>();
  const { leaves } = getSymbolLeavesFast(db, metaSym);
  for (let i = 0; i < leaves.length; i++) {
    const tok = leaves[i]!.text;
    if ((tok === "=" || tok === ":=") && i > 0) {
      const key = leaves[i - 1]!.text;
      if (!isSysmlIdentLeaf(key)) continue;
      const parsed = parseSignedNumberFromLeaves(leaves, i + 1);
      if (parsed && Number.isFinite(parsed.value)) {
        fields.set(key.toLowerCase(), parsed.value);
      }
    }
  }
  return fields;
}

/**
 * Extracts a 3D `CadBoundingBox` from `@SpatialBox` / `@BoundingBox` metadata on `entry` (or its `PartDefinition`).
 */
export function extractSpatialBoundingBox(db: QueryDB, entry: SymbolEntry): CadBoundingBox | null {
  const tryFromSymbol = (sym: SymbolEntry): CadBoundingBox | null => {
    for (const ch of db.childrenOf(sym.id)) {
      if (ch.ruleName !== "MetadataUsage") continue;
      const mName = normalizeTypeName(extractMetadataTypeName(db, ch)).toLowerCase();
      if (mName !== "spatialbox" && mName !== "boundingbox") continue;
      const f = parseMetadataNumericFields(db, ch);

      if (f.has("minx") && f.has("maxx")) {
        const minX = f.get("minx")!;
        const maxX = f.get("maxx")!;
        const minY = f.get("miny") ?? 0;
        const maxY = f.get("maxy") ?? 1;
        const minZ = f.get("minz") ?? 0;
        const maxZ = f.get("maxz") ?? 1;
        if (maxX > minX && maxY > minY && maxZ > minZ) {
          return {
            id: entry.name || String(entry.id),
            name: entry.name,
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
          };
        }
      }

      const x = f.get("x");
      const dx = f.get("dx") ?? f.get("width") ?? f.get("lx");
      if (x !== undefined && dx !== undefined && dx > 0) {
        const y = f.get("y") ?? 0;
        const z = f.get("z") ?? 0;
        const dy = f.get("dy") ?? f.get("height") ?? f.get("ly") ?? 1;
        const dz = f.get("dz") ?? f.get("depth") ?? f.get("lz") ?? 1;
        if (dy > 0 && dz > 0) {
          return {
            id: entry.name || String(entry.id),
            name: entry.name,
            min: [x, y, z],
            max: [x + dx, y + dy, z + dz],
          };
        }
      }
    }
    return null;
  };

  const direct = tryFromSymbol(entry);
  if (direct) return direct;
  const typeDef = resolveTypeOf(db, entry);
  if (typeDef && isUserWorkspaceSymbol(typeDef)) {
    return tryFromSymbol(typeDef);
  }
  return null;
}

function extractConnectionMaxLength(db: QueryDB, connSym: SymbolEntry): number | null {
  const inspectSym = (sym: SymbolEntry): number | null => {
    for (const ch of db.childrenOf(sym.id)) {
      if (ch.ruleName === "MetadataUsage") {
        const mName = normalizeTypeName(extractMetadataTypeName(db, ch)).toLowerCase();
        if (mName === "maxlength") {
          const f = parseMetadataNumericFields(db, ch);
          const v = f.get("max") ?? f.get("maxlength") ?? f.get("length") ?? f.get("limit") ?? f.get("value");
          if (v !== undefined && v > 0) return v;
        }
      } else if (ch.kind === "Usage") {
        let nm = ch.name && ch.name !== "<anonymous>" ? ch.name : "";
        if (!nm) {
          const cls = extractSpecializationClauses(db, ch);
          if (cls.length > 0) nm = cls[0]!.targetPath.split(".").pop()!;
        }
        if (nm.toLowerCase() === "maxlength") {
          const val = getFeatureValue(db, ch, sym.id);
          if (typeof val === "number" && Number.isFinite(val) && val > 0) return val;
        }
      }
    }
    return null;
  };

  const direct = inspectSym(connSym);
  if (direct !== null) return direct;
  const connDef = resolveTypeOf(db, connSym);
  if (connDef && isUserWorkspaceSymbol(connDef)) {
    return inspectSym(connDef);
  }
  return null;
}

/**
 * Validates S6042 (`spatial-envelope-clash-or-protrusion`) using `computeRcc8Relation`
 * and `SpatialPhysicsOracle`.
 */
export function checkSpatialEnvelopes(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  if (!isUserWorkspaceSymbol(self)) return null;
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const diagnostics: LintResult[] = [];
  const selfName = self.name || self.ruleName;

  // 1 & 2. Enclosure protrusion & sibling 3D AABB clash on PartDefinition / PartUsage
  if (self.ruleName === "PartDefinition" || self.ruleName === "PartUsage") {
    const parentBox = extractSpatialBoundingBox(db, self);
    const childBoxes: Array<{ sym: SymbolEntry; box: CadBoundingBox }> = [];

    for (const ch of db.childrenOf(self.id)) {
      if (ch.ruleName !== "PartUsage") continue;
      if (isTruthyMeta(ch, "isRef") || hasHeaderKeyword(db, ch, "ref")) continue;
      const box = extractSpatialBoundingBox(db, ch);
      if (box) childBoxes.push({ sym: ch, box });
    }

    if (parentBox) {
      for (const { sym: childSym, box: childBox } of childBoxes) {
        const rel = computeRcc8Relation(childBox, parentBox, 1e-6);
        if (rel !== "rcc:TPP" && rel !== "rcc:NTPP" && rel !== "rcc:EQ") {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.SPATIAL_ENVELOPE_CLASH_OR_PROTRUSION,
              [
                childSym.name || selfName,
                `child part '${childSym.name || "part"}' protrudes outside enclosure '${selfName}' (${rel})`,
              ],
              childSym,
            ),
          );
        }
      }
    }

    for (let i = 0; i < childBoxes.length; i++) {
      for (let j = i + 1; j < childBoxes.length; j++) {
        const a = childBoxes[i]!;
        const b = childBoxes[j]!;
        const rel = computeRcc8Relation(a.box, b.box, 1e-6);
        if (rel !== "rcc:DC" && rel !== "rcc:EC") {
          const ox = Math.max(0, Math.min(a.box.max[0], b.box.max[0]) - Math.max(a.box.min[0], b.box.min[0]));
          const oy = Math.max(0, Math.min(a.box.max[1], b.box.max[1]) - Math.max(a.box.min[1], b.box.min[1]));
          const oz = Math.max(0, Math.min(a.box.max[2], b.box.max[2]) - Math.max(a.box.min[2], b.box.min[2]));
          const vol = Number((ox * oy * oz).toFixed(4));
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.SPATIAL_ENVELOPE_CLASH_OR_PROTRUSION,
              [
                selfName,
                `sibling parts '${a.sym.name || "partA"}' and '${b.sym.name || "partB"}' clash in 3D space (${rel}, overlap volume ${vol})`,
              ],
              b.sym,
            ),
          );
        }
      }
    }
  }

  // 3. ConnectionUsage physical length bound (`@MaxLength` / `maxLength`) via SpatialPhysicsOracle
  if (self.ruleName === "ConnectionUsage" && self.parentId !== null) {
    const maxL = extractConnectionMaxLength(db, self);
    if (maxL !== null) {
      const ep = extractConnectionEndpointsFast(db, self);
      if (ep && ep.source && ep.target) {
        const partAName = ep.source.split(".")[0]!;
        const partBName = ep.target.split(".")[0]!;
        const partASym = resolveFeatureInScope(db, self.parentId, partAName);
        const partBSym = resolveFeatureInScope(db, self.parentId, partBName);
        const boxA = partASym ? extractSpatialBoundingBox(db, partASym) : null;
        const boxB = partBSym ? extractSpatialBoundingBox(db, partBSym) : null;

        if (boxA && boxB) {
          const centerOf = (b: CadBoundingBox) => ({
            x: 0.5 * (b.min[0] + b.max[0]),
            y: 0.5 * (b.min[1] + b.max[1]),
            z: 0.5 * (b.min[2] + b.max[2]),
          });
          const oracle = new SpatialPhysicsOracle();
          const connLabel = self.name && self.name !== "<anonymous>" ? self.name : `${ep.source}->${ep.target}`;
          oracle.assertPortPosition(ep.source, centerOf(boxA));
          oracle.assertPortPosition(ep.target, centerOf(boxB));
          oracle.assertConnectionLengthBound({
            connectionName: connLabel,
            sourcePort: ep.source,
            targetPort: ep.target,
            maxLengthMeters: maxL,
          });
          const sat = oracle.checkSat();
          if (!sat.isSat) {
            const cA = centerOf(boxA);
            const cB = centerOf(boxB);
            const dist = Math.hypot(cB.x - cA.x, cB.y - cA.y, cB.z - cA.z);
            diagnostics.push(
              emitDiag(db, self, SysML2ErrorCode.SPATIAL_ENVELOPE_CLASH_OR_PROTRUSION, [
                connLabel,
                `connection span ${dist.toFixed(3)} between '${ep.source}' and '${ep.target}' exceeds maxLength ${maxL}`,
              ]),
            );
          }
        }
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}
