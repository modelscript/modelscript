// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/automationml — Closed-Loop Virtual Commissioning Co-Simulation Engine.
 *
 * Couples IEC 61131-3 VirtualPlc discrete scan-cycle execution (@modelscript/plcopen)
 * with continuous first-order mechatronic plant dynamics and 6-DOF spatial kinematics
 * across CAEX InternalLink topologies.
 */

import { parsePlcopen, VirtualPlc } from "@modelscript/plcopen";
import type { AmlDocument, AmlExternalInterface, AmlFrame, AmlInternalElement, AmlInternalLink } from "../types.js";

export type AmlSignalValue = string | number | boolean;

export interface AmlVirtualCommissioningOptions {
  cycles?: number | undefined;
  dtMs?: number | undefined;
  plcSources?: Record<string, string> | undefined;
  initialSignals?: Record<string, AmlSignalValue> | undefined;
}

export interface AmlCycleTelemetry {
  cycle: number;
  timeMs: number;
  signals: Record<string, AmlSignalValue>;
  frames: Record<string, AmlFrame>;
  states: Record<string, number>;
  interlockStatus: "OK" | "TRIPPED";
}

export interface AmlVirtualCommissioningResult {
  cycles: number;
  dtMs: number;
  totalTimeMs: number;
  interlockHealthy: boolean;
  interlockStatus: "OK" | "TRIPPED";
  finalSignals: Record<string, AmlSignalValue>;
  finalFrames: Record<string, AmlFrame>;
  telemetry: AmlCycleTelemetry[];
  history: AmlCycleTelemetry[];
}

interface ElementRuntime {
  element: AmlInternalElement;
  plc?: VirtualPlc | undefined;
  state: number;
  frame: AmlFrame;
  gain: number;
  timeConstant: number;
  threshold: number;
}

function getNumericAttr(el: AmlInternalElement, names: string[], fallback: number): number {
  for (const name of names) {
    const attr = el.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (attr && typeof attr.value === "number" && Number.isFinite(attr.value)) {
      return attr.value;
    }
    if (attr && typeof attr.defaultValue === "number" && Number.isFinite(attr.defaultValue)) {
      return attr.defaultValue;
    }
  }
  return fallback;
}

function defaultPortValue(iface: AmlExternalInterface): AmlSignalValue {
  const dt = (iface.dataType ?? "").toLowerCase();
  if (dt.includes("bool")) return false;
  if (dt.includes("string")) return "";
  return 0;
}

export function runAmlVirtualCommissioning(
  doc: AmlDocument,
  options?: AmlVirtualCommissioningOptions,
): AmlVirtualCommissioningResult {
  const cycles = options?.cycles ?? 20;
  const dtMs = options?.dtMs ?? 10;
  const dtSec = dtMs / 1000;
  const plcSources = options?.plcSources ?? {};

  const allElements: AmlInternalElement[] = [];
  const allLinks: AmlInternalLink[] = [];

  const collectElements = (el: AmlInternalElement): void => {
    allElements.push(el);
    for (const link of el.internalLinks) {
      allLinks.push(link);
    }
    for (const child of el.children) {
      collectElements(child);
    }
  };

  for (const ih of doc.instanceHierarchies) {
    for (const el of ih.elements) {
      collectElements(el);
    }
  }

  const runtimes = new Map<string, ElementRuntime>();
  const signals = new Map<string, AmlSignalValue>();
  const portLookup = new Map<string, { el: AmlInternalElement; iface: AmlExternalInterface }>();

  const setSignalValue = (el: AmlInternalElement, iface: AmlExternalInterface, val: AmlSignalValue): void => {
    signals.set(`${el.id}:${iface.name}`, val);
    signals.set(`${el.name}:${iface.name}`, val);
    signals.set(`${el.name}.${iface.name}`, val);
    signals.set(iface.id, val);
  };

  const getSignalValue = (el: AmlInternalElement, iface: AmlExternalInterface): AmlSignalValue => {
    return (
      signals.get(`${el.id}:${iface.name}`) ??
      signals.get(`${el.name}:${iface.name}`) ??
      signals.get(`${el.name}.${iface.name}`) ??
      defaultPortValue(iface)
    );
  };

  // Initialize element runtimes, ports, and linked VirtualPlc instances
  for (const el of allElements) {
    const f = el.frame;
    const initialFrame: AmlFrame = {
      x: f && Number.isFinite(f.x) ? f.x : 0,
      y: f && Number.isFinite(f.y) ? f.y : 0,
      z: f && Number.isFinite(f.z) ? f.z : 0,
      rx: f && Number.isFinite(f.rx) ? f.rx : 0,
      ry: f && Number.isFinite(f.ry) ? f.ry : 0,
      rz: f && Number.isFinite(f.rz) ? f.rz : 0,
    };

    const gain = getNumericAttr(el, ["gain", "maxSpeed", "nominalSpeed", "speed"], 1.0);
    const timeConstant = Math.max(0.001, getNumericAttr(el, ["timeConstant", "tau"], 0.05));
    const threshold = getNumericAttr(el, ["threshold", "stroke", "length", "targetPosition"], 0.02);

    let plcInstance: VirtualPlc | undefined = undefined;
    let resolvedPlcSource = plcSources[el.id] ?? plcSources[el.name];
    if (!resolvedPlcSource) {
      for (const iface of el.interfaces) {
        if (iface.refUri) {
          const rawUri = iface.refUri;
          const stripped = rawUri.replace(/^file:\/\//, "").replace(/^\.\//, "");
          resolvedPlcSource = plcSources[rawUri] ?? plcSources[stripped];
          if (resolvedPlcSource) break;
        }
      }
    }
    if (!resolvedPlcSource) {
      const codeAttr = el.attributes.find(
        (a) => a.name.toLowerCase() === "plccode" || a.name.toLowerCase() === "stcode",
      );
      if (typeof codeAttr?.value === "string") {
        resolvedPlcSource = codeAttr.value;
      }
    }

    if (resolvedPlcSource) {
      const plcProject = parsePlcopen(resolvedPlcSource);
      plcInstance = new VirtualPlc(plcProject);
    }

    for (const iface of el.interfaces) {
      const initVal = defaultPortValue(iface);
      setSignalValue(el, iface, initVal);
      portLookup.set(`${el.id}:${iface.name}`, { el, iface });
      portLookup.set(`${el.name}:${iface.name}`, { el, iface });
      portLookup.set(`${el.id}:${iface.id}`, { el, iface });
      portLookup.set(iface.id, { el, iface });
    }

    const rt: ElementRuntime = {
      element: el,
      plc: plcInstance,
      state: 0,
      frame: initialFrame,
      gain,
      timeConstant,
      threshold,
    };
    runtimes.set(el.id, rt);
  }

  // Apply any user-supplied initial signal overrides
  if (options?.initialSignals) {
    for (const [k, v] of Object.entries(options.initialSignals)) {
      const resolved = portLookup.get(k);
      if (resolved) {
        setSignalValue(resolved.el, resolved.iface, v);
      } else {
        signals.set(k, v);
      }
    }
  }

  const propagateLinks = (): void => {
    for (const link of allLinks) {
      const sideA = portLookup.get(link.refPartnerSideA);
      const sideB = portLookup.get(link.refPartnerSideB);
      if (!sideA || !sideB) continue;

      if (sideA.iface.direction === "In" && sideB.iface.direction === "Out") {
        const val = getSignalValue(sideB.el, sideB.iface);
        setSignalValue(sideA.el, sideA.iface, val);
      } else {
        const val = getSignalValue(sideA.el, sideA.iface);
        setSignalValue(sideB.el, sideB.iface, val);
      }
    }
  };

  const telemetry: AmlCycleTelemetry[] = [];
  let interlockHealthy = true;

  for (let c = 1; c <= cycles; c++) {
    // 1. Propagate InternalLinks before PLC scan
    propagateLinks();

    // 2. Execute PLC scan cycles and built-in controller/plant dynamics
    for (const rt of runtimes.values()) {
      const el = rt.element;

      // Check safety interlock ports (e.g., eStop, emergencyStop, safetyFault)
      for (const iface of el.interfaces) {
        const lowName = iface.name.toLowerCase();
        if (lowName === "estop" || lowName === "emergencystop" || lowName === "safetyfault") {
          const val = getSignalValue(el, iface);
          if (val === true || (typeof val === "number" && val > 0)) {
            interlockHealthy = false;
          }
        }
      }

      if (rt.plc) {
        // Synchronize AML In ports -> VirtualPlc inputs
        for (const iface of el.interfaces) {
          if (iface.direction === "In" || iface.direction === "InOut") {
            const val = getSignalValue(el, iface);
            rt.plc.setVariable(iface.name, val);
          }
        }

        rt.plc.step(dtMs);

        // Synchronize VirtualPlc outputs -> AML Out ports
        const allPlcVars = rt.plc.getAllVariables();
        const lowerPlcMap = new Map<string, AmlSignalValue>();
        for (const [k, v] of Object.entries(allPlcVars)) {
          lowerPlcMap.set(k.toLowerCase(), v);
          const dotIdx = k.lastIndexOf(".");
          if (dotIdx !== -1) {
            lowerPlcMap.set(k.slice(dotIdx + 1).toLowerCase(), v);
          }
        }

        for (const iface of el.interfaces) {
          if (iface.direction === "Out" || iface.direction === "InOut") {
            const outVal = rt.plc.getVariable(iface.name) ?? lowerPlcMap.get(iface.name.toLowerCase());
            if (outVal !== undefined) {
              setSignalValue(el, iface, outVal);
            }
          }
        }
      } else {
        // Built-in mechatronic element dynamics
        const inPorts = el.interfaces.filter((i) => i.direction === "In");
        const outPorts = el.interfaces.filter((i) => i.direction === "Out");

        let driveSignal = 0;
        if (inPorts.length === 0 && outPorts.length > 0) {
          // Autonomous source / command generator if no inputs exist
          driveSignal = interlockHealthy ? 1.0 : 0.0;
        } else {
          for (const inp of inPorts) {
            const v = getSignalValue(el, inp);
            if (typeof v === "boolean") {
              if (v) driveSignal = Math.max(driveSignal, 1.0);
            } else if (typeof v === "number") {
              driveSignal = Math.max(driveSignal, v);
            }
          }
        }

        if (!interlockHealthy) {
          driveSignal = 0;
        }

        const targetState = rt.gain * driveSignal;
        const alpha = Math.min(1.0, dtSec / rt.timeConstant);
        rt.state = rt.state + alpha * (targetState - rt.state);
        rt.frame = {
          ...rt.frame,
          x: rt.frame.x + rt.state * dtSec,
        };

        for (const outp of outPorts) {
          const dt = (outp.dataType ?? "").toLowerCase();
          const lowName = outp.name.toLowerCase();
          if (
            dt.includes("bool") ||
            lowName.includes("sensor") ||
            lowName.includes("present") ||
            lowName.includes("cmd") ||
            lowName.includes("start")
          ) {
            const boolVal =
              inPorts.length === 0 ? interlockHealthy : rt.frame.x >= rt.threshold || rt.state >= 0.5 * rt.gain;
            setSignalValue(el, outp, boolVal);
          } else if (lowName.includes("pos")) {
            setSignalValue(el, outp, Number(rt.frame.x.toFixed(6)));
          } else {
            setSignalValue(el, outp, Number(rt.state.toFixed(6)));
          }
        }
      }
    }

    // 3. Propagate updated outputs across InternalLinks
    propagateLinks();

    // 4. Record cycle telemetry snapshot
    const cycleSignals: Record<string, AmlSignalValue> = {};
    for (const [k, v] of signals.entries()) {
      cycleSignals[k] = v;
    }

    const cycleFrames: Record<string, AmlFrame> = {};
    const cycleStates: Record<string, number> = {};
    for (const rt of runtimes.values()) {
      const fCopy: AmlFrame = { ...rt.frame };
      cycleFrames[rt.element.id] = fCopy;
      cycleFrames[rt.element.name] = fCopy;
      cycleStates[rt.element.id] = rt.state;
      cycleStates[rt.element.name] = rt.state;
    }

    telemetry.push({
      cycle: c,
      timeMs: c * dtMs,
      signals: cycleSignals,
      frames: cycleFrames,
      states: cycleStates,
      interlockStatus: interlockHealthy ? "OK" : "TRIPPED",
    });
  }

  const lastSnap = telemetry[telemetry.length - 1];
  const finalSignals: Record<string, AmlSignalValue> = lastSnap ? { ...lastSnap.signals } : {};
  const finalFrames: Record<string, AmlFrame> = lastSnap ? { ...lastSnap.frames } : {};

  return {
    cycles,
    dtMs,
    totalTimeMs: cycles * dtMs,
    interlockHealthy,
    interlockStatus: interlockHealthy ? "OK" : "TRIPPED",
    finalSignals,
    finalFrames,
    telemetry,
    history: telemetry,
  };
}
