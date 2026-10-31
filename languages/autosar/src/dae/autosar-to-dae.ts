// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { AutosarModel, AutosarSwComponent } from "../types.js";

export interface AutosarDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  includePlantModel?: boolean | undefined;
}

/**
 * Direct lowering of AUTOSAR software component architectures and virtual ECUs
 * to ModelScript's linear-memory WebAssembly DAE arena.
 */
export function lowerAutosarToDae(model: AutosarModel, options?: AutosarDaeOptions): DAEBuilder {
  const modelName = options?.modelName ?? "AutosarSystem";
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);

  // Map of port variables: "compName.portName.dataElement" -> { varId: number, varName: string, exprId: number, initVal: number }
  const portVarMap = new Map<string, { varId: number; varName: string; exprId: number; initVal: number }>();
  const uniquePortVars: { varId: number; varName: string; exprId: number; initVal: number }[] = [];
  const definedVarIds = new Set<number>();

  // 1. Lower all Atomic SWC ports into variables
  for (const [compName, swc] of model.components) {
    if (swc.kind === "COMPOSITION-SW-COMPONENT-TYPE") continue;

    for (const [portName, port] of swc.ports) {
      const ifaceName = port.interfaceRef.split("/").pop() ?? port.interfaceRef;
      const iface = model.interfaces.get(ifaceName);

      const causality =
        port.direction === "provided"
          ? Causality.Output
          : port.direction === "required"
            ? Causality.Input
            : Causality.Local;

      if (iface?.dataElements && iface.dataElements.length > 0) {
        for (const de of iface.dataElements) {
          const varName = `${compName}_${portName}_${de.shortName}`;
          const initVal = typeof de.initValue === "number" ? de.initValue : 0.0;
          const varId = dae.addVariable(varName, VarType.Real, Variability.Continuous, causality, initVal);
          const exprId = dae.addNameExpr(varName);
          const entry = { varId, varName, exprId, initVal };
          portVarMap.set(`${compName}.${portName}.${de.shortName}`, entry);
          portVarMap.set(`${compName}.${portName}`, entry); // fallback
          uniquePortVars.push(entry);
        }
      } else {
        const varName = `${compName}_${portName}`;
        const varId = dae.addVariable(varName, VarType.Real, Variability.Continuous, causality, 0.0);
        const exprId = dae.addNameExpr(varName);
        const entry = { varId, varName, exprId, initVal: 0.0 };
        portVarMap.set(`${compName}.${portName}`, entry);
        uniquePortVars.push(entry);
      }
    }

    // Lower internal behavior relationships
    if (swc.internalBehavior) {
      lowerSwcBehavior(swc, dae, portVarMap, definedVarIds);
    }
  }

  // 2. Lower Assembly Connectors into equality equations
  for (const comp of model.components.values()) {
    if (comp.kind === "COMPOSITION-SW-COMPONENT-TYPE" && comp.connectors) {
      for (const conn of comp.connectors) {
        if (
          conn.kind === "ASSEMBLY-SW-CONNECTOR" &&
          conn.provider?.component &&
          conn.provider?.port &&
          conn.requirer?.component &&
          conn.requirer?.port
        ) {
          const provProto = comp.subComponents?.get(conn.provider.component);
          const provCompName = provProto
            ? (provProto.typeRef.split("/").pop() ?? conn.provider.component)
            : conn.provider.component;
          const reqProto = comp.subComponents?.get(conn.requirer.component);
          const reqCompName = reqProto
            ? (reqProto.typeRef.split("/").pop() ?? conn.requirer.component)
            : conn.requirer.component;

          const provKey = `${provCompName}.${conn.provider.port}`;
          const reqKey = `${reqCompName}.${conn.requirer.port}`;

          // Connect matching data elements or direct port
          let matched = false;
          for (const [kProv, provEntry] of portVarMap) {
            if (kProv.startsWith(`${provKey}.`)) {
              const deName = kProv.slice(provKey.length + 1);
              const reqEntry = portVarMap.get(`${reqKey}.${deName}`);
              if (reqEntry !== undefined && !definedVarIds.has(reqEntry.varId)) {
                dae.addEquation(EqKind.Simple, reqEntry.exprId, provEntry.exprId);
                definedVarIds.add(reqEntry.varId);
                matched = true;
              }
            }
          }

          if (!matched) {
            const pEntry = portVarMap.get(provKey);
            const rEntry = portVarMap.get(reqKey);
            if (pEntry !== undefined && rEntry !== undefined && !definedVarIds.has(rEntry.varId)) {
              dae.addEquation(EqKind.Simple, rEntry.exprId, pEntry.exprId);
              definedVarIds.add(rEntry.varId);
            }
          }
        }
      }
    }
  }

  // Bind any remaining open/source port variables to their initial values for structural squareness
  for (const entry of uniquePortVars) {
    if (!definedVarIds.has(entry.varId)) {
      dae.addEquation(EqKind.Simple, entry.exprId, dae.addRealLiteral(entry.initVal));
      definedVarIds.add(entry.varId);
    }
  }

  // 3. Optional 1D continuous vehicle plant model coupled to AUTOSAR ECUs
  if (options?.includePlantModel) {
    lowerVehiclePlantModel(dae, portVarMap);
  }

  return dae;
}

function lowerSwcBehavior(
  swc: AutosarSwComponent,
  dae: DAEBuilder,
  portVarMap: Map<string, { varId: number; varName: string; exprId: number; initVal: number }>,
  definedVarIds: Set<number>,
): void {
  if (!swc.internalBehavior) return;

  for (const runnable of swc.internalBehavior.runnables.values()) {
    // If runnable has both read and write access, form continuous behavioral equations
    if (runnable.dataReadAccess.length > 0 && runnable.dataWriteAccess.length > 0) {
      for (let i = 0; i < runnable.dataWriteAccess.length; i++) {
        const write = runnable.dataWriteAccess[i];
        const read = runnable.dataReadAccess[i % runnable.dataReadAccess.length];
        if (!write || !read) continue;

        const wKey = `${swc.shortName}.${write.port}.${write.dataElement}`;
        const rKey = `${swc.shortName}.${read.port}.${read.dataElement}`;

        const wEntry = portVarMap.get(wKey) ?? portVarMap.get(`${swc.shortName}.${write.port}`);
        const rEntry = portVarMap.get(rKey) ?? portVarMap.get(`${swc.shortName}.${read.port}`);

        if (
          wEntry !== undefined &&
          rEntry !== undefined &&
          wEntry.varId !== rEntry.varId &&
          !definedVarIds.has(wEntry.varId)
        ) {
          // writeVar = 0.95 * readVar
          const gainExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.95), rEntry.exprId);
          dae.addEquation(EqKind.Simple, wEntry.exprId, gainExpr);
          definedVarIds.add(wEntry.varId);
        }
      }
    }
  }
}

function lowerVehiclePlantModel(
  dae: DAEBuilder,
  portVarMap: Map<string, { varId: number; varName: string; exprId: number; initVal: number }>,
): void {
  // Continuous 1D longitudinal vehicle dynamics
  dae.addVariable("vehicle_speed", VarType.Real, Variability.Continuous, Causality.Output, 0.0);
  const vSpeedExpr = dae.addNameExpr("vehicle_speed");

  dae.addVariable("der_vehicle_speed", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const derSpeedExpr = dae.addNameExpr("der_vehicle_speed");

  dae.addVariable("vehicle_position", VarType.Real, Variability.Continuous, Causality.Output, 0.0);
  const vPosExpr = dae.addNameExpr("vehicle_position");

  dae.addVariable("der_vehicle_position", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const derPosExpr = dae.addNameExpr("der_vehicle_position");

  dae.addVariable("engine_torque", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const engineTorqueExpr = dae.addNameExpr("engine_torque");

  // Bind state derivative variables to der(...)
  dae.addEquation(EqKind.Simple, derPosExpr, dae.addDerExpr(vPosExpr));
  dae.addEquation(EqKind.Simple, derSpeedExpr, dae.addDerExpr(vSpeedExpr));

  // der(vehicle_position) = vehicle_speed
  dae.addEquation(EqKind.Simple, derPosExpr, vSpeedExpr);

  // Find throttle actuator output from any SWC
  let throttleExpr: number | null = null;
  for (const [key, entry] of portVarMap) {
    if (key.toLowerCase().includes("throttle")) {
      throttleExpr = entry.exprId;
      break;
    }
  }

  // engine_torque = (throttleExpr ?? 1.0) * 350.0
  const cmdThrottle = throttleExpr !== null ? throttleExpr : dae.addRealLiteral(1.0);
  const torqueRhs = dae.addBinaryExpr(BinOp.Mul, cmdThrottle, dae.addRealLiteral(350.0));
  dae.addEquation(EqKind.Simple, engineTorqueExpr, torqueRhs);

  // der(vehicle_speed) = (engine_torque - 0.3 * vehicle_speed) / 1500.0
  const dragExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.3), vSpeedExpr);
  const netForce = dae.addBinaryExpr(BinOp.Sub, engineTorqueExpr, dragExpr);
  const accelExpr = dae.addBinaryExpr(BinOp.Div, netForce, dae.addRealLiteral(1500.0));
  dae.addEquation(EqKind.Simple, derSpeedExpr, accelExpr);
}
