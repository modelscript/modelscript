// SPDX-License-Identifier: AGPL-3.0-or-later

import { type CadDynamicProperty, type ModelicaTelemetryParams, type SpoolKinematicsSpec } from "@modelscript/cad";
import { type CadComponent } from "@modelscript/cad-viewer";
import { AnimationController } from "@modelscript/cad-viewer/animation-controller";
import { resolveSpoolRulesForAnsatz } from "../util/step-pairing";

export function attachScadKinematicController(
  scadCode: string,
  components: CadComponent[],
  ctrlRef: { current: AnimationController | null },
  setAnimationMode: (mode: "stopped" | "playing" | "paused" | "live") => void,
  structuredSpools?: readonly SpoolKinematicsSpec[],
  telemetry?: ModelicaTelemetryParams,
): CadComponent[] {
  const spoolRules = resolveSpoolRulesForAnsatz(scadCode, structuredSpools, telemetry);

  if (spoolRules.length === 0 || components.length === 0) {
    return components;
  }

  const enhanced = components.map((comp) => {
    const nameLower = comp.name.toLowerCase();
    const matched = spoolRules.filter(
      (r) => !r.match || nameLower === r.match || nameLower.includes(r.match) || r.match.includes(nameLower),
    );
    if (matched.length === 0) return comp;
    return {
      ...comp,
      dynamicBindings: [
        ...(comp.dynamicBindings ?? []),
        ...matched.map((r) => ({
          property: "rotation" as const,
          index: r.axisIndex,
          variable: r.varName,
        })),
      ],
    };
  });

  const anyBound = enhanced.some((c) => c.dynamicBindings && c.dynamicBindings.length > 0);
  if (!anyBound) return components;

  let ctrl = ctrlRef.current;
  if (!ctrl) {
    ctrl = new AnimationController();
    ctrl.onStateChange((s) => setAnimationMode(s.mode));
    ctrlRef.current = ctrl;
  }

  ctrl.setBindings(
    enhanced
      .filter((c) => c.dynamicBindings && c.dynamicBindings.length > 0)
      .map((c) => ({
        componentName: c.name,
        bindings: c.dynamicBindings!.map((b) => ({
          property: b.property as CadDynamicProperty,
          index: b.index,
          variable: b.variable,
        })),
      })),
  );
  for (const comp of enhanced) {
    const cadObj = typeof comp.cad === "object" && comp.cad ? comp.cad : undefined;
    ctrl.setDefault(comp.name, {
      position: cadObj?.position ?? [0, 0, 0],
      rotation: [0, 0, 0],
      scale: cadObj?.scale ?? [1, 1, 1],
    });
  }

  const dt = 0.05;
  const steps = 200;
  const t: number[] = [];
  const y: number[][] = [];
  const varNames = spoolRules.map((r) => r.varName);
  for (let i = 0; i <= steps; i++) {
    const ti = i * dt;
    t.push(ti);
    y.push(spoolRules.map((r) => ti * r.degPerSec));
  }
  ctrl.loadTimeseries(t, y, varNames);
  ctrl.setLoop(true);
  ctrl.play();
  return enhanced;
}

function isIdentCharCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 // _
  );
}

function isWhitespaceCharCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

const MODELICA_CLASS_KEYWORDS = new Set(["model", "block", "class", "package", "function", "record"]);

export function hasModelicaClassDeclaration(code: string, className: string): boolean {
  if (!className) return false;
  const n = code.length;
  let i = 0;
  while (i < n) {
    const ch = code.charCodeAt(i);
    // Skip line comments // ...
    if (ch === 47 && i + 1 < n && code.charCodeAt(i + 1) === 47) {
      i += 2;
      while (i < n && code.charCodeAt(i) !== 10) i++;
      continue;
    }
    // Skip block comments /* ... */
    if (ch === 47 && i + 1 < n && code.charCodeAt(i + 1) === 42) {
      i += 2;
      while (i + 1 < n && !(code.charCodeAt(i) === 42 && code.charCodeAt(i + 1) === 47)) i++;
      i += 2;
      continue;
    }
    // Skip string literals "..."
    if (ch === 34) {
      i++;
      while (i < n && code.charCodeAt(i) !== 34) {
        if (code.charCodeAt(i) === 92) i++;
        i++;
      }
      i++;
      continue;
    }
    if (isIdentCharCode(ch)) {
      const start = i;
      while (i < n && isIdentCharCode(code.charCodeAt(i))) i++;
      const tok = code.slice(start, i);
      if (MODELICA_CLASS_KEYWORDS.has(tok)) {
        let j = i;
        while (j < n && isWhitespaceCharCode(code.charCodeAt(j))) j++;
        if (j > i && j < n && isIdentCharCode(code.charCodeAt(j))) {
          const nameStart = j;
          while (j < n && isIdentCharCode(code.charCodeAt(j))) j++;
          if (code.slice(nameStart, j) === className) return true;
        }
      }
      continue;
    }
    i++;
  }
  return false;
}

function findBalancedExperimentBody(code: string): string | null {
  const lower = code.toLowerCase();
  const n = code.length;
  let pos = 0;
  while (pos < n) {
    const idx = lower.indexOf("experiment", pos);
    if (idx < 0) return null;
    const beforeOk = idx === 0 || !isIdentCharCode(code.charCodeAt(idx - 1));
    const afterIdx = idx + 10;
    const afterOk = afterIdx >= n || !isIdentCharCode(code.charCodeAt(afterIdx));
    if (beforeOk && afterOk) {
      let j = afterIdx;
      while (j < n && isWhitespaceCharCode(code.charCodeAt(j))) j++;
      if (j < n && code.charCodeAt(j) === 40) {
        // '('
        const openIdx = j;
        let depth = 1;
        j++;
        while (j < n && depth > 0) {
          const c = code.charCodeAt(j);
          if (c === 34 || c === 39) {
            const quote = c;
            j++;
            while (j < n && code.charCodeAt(j) !== quote) {
              if (code.charCodeAt(j) === 92) j++;
              j++;
            }
          } else if (c === 40) {
            depth++;
          } else if (c === 41) {
            depth--;
            if (depth === 0) return code.slice(openIdx + 1, j);
          }
          j++;
        }
        return null;
      }
    }
    pos = idx + 10;
  }
  return null;
}

function parseExperimentAttributes(body: string): Map<string, { raw: string; quoted: boolean }> {
  const attrs = new Map<string, { raw: string; quoted: boolean }>();
  const n = body.length;
  let i = 0;
  while (i < n) {
    while (i < n && (isWhitespaceCharCode(body.charCodeAt(i)) || body.charCodeAt(i) === 44)) i++;
    if (i >= n) break;
    if (!isIdentCharCode(body.charCodeAt(i))) {
      i++;
      continue;
    }
    const keyStart = i;
    while (i < n && isIdentCharCode(body.charCodeAt(i))) i++;
    const key = body.slice(keyStart, i).toLowerCase();

    while (i < n && isWhitespaceCharCode(body.charCodeAt(i))) i++;
    if (i >= n || body.charCodeAt(i) !== 61) {
      // Skip until next top-level comma
      let depth = 0;
      while (i < n) {
        const c = body.charCodeAt(i);
        if (c === 34 || c === 39) {
          const q = c;
          i++;
          while (i < n && body.charCodeAt(i) !== q) {
            if (body.charCodeAt(i) === 92) i++;
            i++;
          }
        } else if (c === 40) {
          depth++;
        } else if (c === 41 && depth > 0) {
          depth--;
        } else if (c === 44 && depth === 0) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++; // consume '='
    while (i < n && isWhitespaceCharCode(body.charCodeAt(i))) i++;
    if (i >= n) break;

    const first = body.charCodeAt(i);
    if (first === 34 || first === 39) {
      const quote = first;
      i++;
      const valStart = i;
      while (i < n && body.charCodeAt(i) !== quote) {
        if (body.charCodeAt(i) === 92) i++;
        i++;
      }
      const val = body.slice(valStart, i);
      if (i < n && body.charCodeAt(i) === quote) i++;
      if (!attrs.has(key)) attrs.set(key, { raw: val, quoted: true });
    } else {
      const valStart = i;
      let depth = 0;
      while (i < n) {
        const c = body.charCodeAt(i);
        if (c === 40) depth++;
        else if (c === 41 && depth > 0) depth--;
        else if (depth === 0 && (c === 44 || isWhitespaceCharCode(c))) break;
        i++;
      }
      const val = body.slice(valStart, i).trim();
      if (!attrs.has(key)) attrs.set(key, { raw: val, quoted: false });
    }
  }
  return attrs;
}

/** Extract experiment(StartTime=..., StopTime=..., Tolerance=..., Interval=...) annotation from source. */
export function extractExperimentFromCode(code: string): {
  StartTime?: number;
  StopTime?: number;
  Tolerance?: number;
  Interval?: number;
  startTime?: number;
  stopTime?: number;
  tolerance?: number;
  interval?: number;
  numberOfIntervals?: number;
  solver?: string;
} | null {
  const body = findBalancedExperimentBody(code);
  if (!body) return null;
  const attrs = parseExperimentAttributes(body);
  const numAttr = (name: string): number | undefined => {
    const entry = attrs.get(name.toLowerCase());
    if (!entry || entry.quoted || !entry.raw) return undefined;
    const parsed = Number(entry.raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const strAttr = (name: string): string | undefined => {
    const entry = attrs.get(name.toLowerCase());
    return entry?.quoted && entry.raw.length > 0 ? entry.raw : undefined;
  };
  const startTime = numAttr("StartTime");
  const stopTime = numAttr("StopTime");
  const tolerance = numAttr("Tolerance");
  const interval = numAttr("Interval");
  const numberOfIntervals = numAttr("NumberOfIntervals");
  const solver = strAttr("Algorithm") ?? strAttr("__Dymola_Algorithm") ?? strAttr("Solver");
  if (
    startTime === undefined &&
    stopTime === undefined &&
    tolerance === undefined &&
    interval === undefined &&
    numberOfIntervals === undefined &&
    solver === undefined
  ) {
    return null;
  }
  return {
    ...(startTime !== undefined ? { startTime, StartTime: startTime } : {}),
    ...(stopTime !== undefined ? { stopTime, StopTime: stopTime } : {}),
    ...(tolerance !== undefined ? { tolerance, Tolerance: tolerance } : {}),
    ...(interval !== undefined ? { interval, Interval: interval } : {}),
    ...(numberOfIntervals !== undefined ? { numberOfIntervals } : {}),
    ...(solver !== undefined ? { solver } : {}),
  };
}
