// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CIGRE_WASM_MEMORY_LAYOUT,
  type CigreModelInputs,
  type CigreModelOutputs,
} from "../firmware/cigre-tb881-abi.js";
import { computeP3743PayloadDigest, validateP3743Package } from "./p3743-reader.js";
import type { P3743Package, P3743VendorModelEncapsulation } from "./types.js";

export interface P3743WasmVendorHandle {
  id: string;
  busId: string;
  modelName: string;
  step(inputs: CigreModelInputs): CigreModelOutputs;
}

/**
 * Instantiates all verified `cigre-tb881-wasm` vendor models in an IEEE P3743 package
 * using `CIGRE_WASM_MEMORY_LAYOUT` for zero-copy linear-memory marshalling.
 */
export async function instantiateP3743WasmVendorModels(pkg: P3743Package): Promise<P3743WasmVendorHandle[]> {
  const validation = validateP3743Package(pkg);
  if (!validation.valid) {
    throw new Error(`Invalid IEEE P3743 package: ${validation.errors.join("; ")}`);
  }

  const handles: P3743WasmVendorHandle[] = [];
  for (const vm of pkg.vendorModels) {
    if (vm.payloadKind !== "cigre-tb881-wasm" || !vm.payloadBase64) continue;
    handles.push(await instantiateSingleWasmVendorModel(vm));
  }
  return handles;
}

async function instantiateSingleWasmVendorModel(vm: P3743VendorModelEncapsulation): Promise<P3743WasmVendorHandle> {
  const bytes = Buffer.from(vm.payloadBase64!, "base64");
  const digest = computeP3743PayloadDigest(bytes);
  if (digest !== vm.sha256.toLowerCase()) {
    throw new Error(`Vendor model '${vm.id}' SHA-256 mismatch.`);
  }

  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as {
    memory?: WebAssembly.Memory;
    Model_Initialize?: (nominalFreqHz: number, mbaseMva: number, vNominalKv: number) => void;
    Model_Outputs?: (inputPtr: number, outputPtr: number) => void;
  };

  if (!exports.memory) {
    throw new Error(`Vendor model '${vm.id}' WASM module must export 'memory'.`);
  }

  exports.Model_Initialize?.(vm.initParams.nominalFreqHz, vm.initParams.mbaseMva, vm.initParams.vNominalKv);

  const memory = exports.memory;

  return {
    id: vm.id,
    busId: vm.busId,
    modelName: vm.modelInfo.modelName,
    step(inputs: CigreModelInputs): CigreModelOutputs {
      const inView = new Float64Array(
        memory.buffer,
        CIGRE_WASM_MEMORY_LAYOUT.INPUT_OFFSET_BYTES,
        CIGRE_WASM_MEMORY_LAYOUT.INPUT_SIZE_DOUBLES,
      );
      inView[0] = inputs.timeSec;
      inView[1] = inputs.va;
      inView[2] = inputs.vb;
      inView[3] = inputs.vc;
      inView[4] = inputs.ia;
      inView[5] = inputs.ib;
      inView[6] = inputs.ic;
      inView[7] = inputs.pRefPu;
      inView[8] = inputs.qRefPu ?? 0;
      inView[9] = inputs.vRefPu ?? 1;

      exports.Model_Outputs?.(
        CIGRE_WASM_MEMORY_LAYOUT.INPUT_OFFSET_BYTES,
        CIGRE_WASM_MEMORY_LAYOUT.OUTPUT_OFFSET_BYTES,
      );

      const outView = new Float64Array(
        memory.buffer,
        CIGRE_WASM_MEMORY_LAYOUT.OUTPUT_OFFSET_BYTES,
        CIGRE_WASM_MEMORY_LAYOUT.OUTPUT_SIZE_DOUBLES,
      );
      const flags = Math.trunc(outView[5] ?? 0);
      return {
        timeSec: outView[0] ?? inputs.timeSec,
        idTargetPu: outView[1] ?? 0,
        iqTargetPu: outView[2] ?? 0,
        mRealPu: outView[3] ?? 0,
        mImagPu: outView[4] ?? 0,
        isRideThroughActive: (flags & CIGRE_WASM_MEMORY_LAYOUT.FLAG_RIDE_THROUGH) !== 0,
        isCurrentLimitReached: (flags & CIGRE_WASM_MEMORY_LAYOUT.FLAG_CURRENT_LIMIT) !== 0,
        isMomentaryCessation: (flags & CIGRE_WASM_MEMORY_LAYOUT.FLAG_MOMENTARY_CESSATION) !== 0,
        isTripped: false,
        tripReasonCode: outView[6] ?? 0,
      };
    },
  };
}
