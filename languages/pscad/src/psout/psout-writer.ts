// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-performance writer for PSCAD V5+ binary *.psout files.
 * Uses the AssemblyScript WebAssembly kernel for zero-copy memory packing.
 */

import type { SimulationResultLike } from "../comtrade/comtrade-writer.js";
import type { PscadPsoutWriteOptions } from "./psout-types.js";
import { PsoutWasmBridge } from "./psout-wasm-bridge.js";

interface ChannelSpec {
  name: string;
  unit: string;
  group: string;
  data: Float64Array;
}

export function writePscadPsout(result: SimulationResultLike, options?: PscadPsoutWriteOptions): Uint8Array {
  const pageSize = options?.pageSize ?? 1024;
  const bridge = PsoutWasmBridge.create();

  // Initialize writer in WASM linear memory
  bridge.exports.psout_writer_init(pageSize);

  // Write Time Domain vector
  const timeMem = bridge.writeFloat64ToMemory(result.time);
  bridge.exports.psout_writer_set_time(timeMem.ptr, timeMem.count);

  // Collect all channels from SimulationResultLike
  const channels: ChannelSpec[] = [];

  for (const [bus, v] of result.busVoltages) {
    channels.push({ name: `V_${bus}`, unit: "V", group: "Voltages", data: v });
    const ph = result.busPhaseVoltages?.get(bus);
    if (ph) {
      channels.push({ name: `V_${bus}_B`, unit: "V", group: "Voltages", data: ph.b });
      channels.push({ name: `V_${bus}_C`, unit: "V", group: "Voltages", data: ph.c });
    }
  }

  for (const [br, i] of result.branchCurrents ?? []) {
    channels.push({ name: `I_${br}`, unit: "A", group: "Currents", data: i });
    const ph = result.branchPhaseCurrents?.get(br);
    if (ph) {
      channels.push({ name: `I_${br}_B`, unit: "A", group: "Currents", data: ph.b });
      channels.push({ name: `I_${br}_C`, unit: "A", group: "Currents", data: ph.c });
    }
  }

  for (const [sig, s] of result.controlSignals ?? []) {
    channels.push({ name: sig, unit: "", group: "Controls", data: s });
  }

  // Register each channel with WASM kernel
  for (const ch of channels) {
    const dataMem = bridge.writeFloat64ToMemory(ch.data);
    const nameMem = bridge.writeStringToMemory(ch.name);
    const unitMem = bridge.writeStringToMemory(ch.unit);
    const groupMem = bridge.writeStringToMemory(ch.group);

    bridge.exports.psout_writer_add_trace(
      nameMem.ptr,
      nameMem.len,
      unitMem.ptr,
      unitMem.len,
      groupMem.ptr,
      groupMem.len,
      dataMem.ptr,
      dataMem.count,
    );
  }

  // Finalize binary layout in WASM
  const createdSec =
    options?.createdEpochSec != null ? BigInt(options.createdEpochSec) : BigInt(Math.floor(Date.now() / 1000));

  const totalFileSize = bridge.exports.psout_writer_build(createdSec);
  const outPtr = bridge.exports.psout_get_buffer_ptr();

  return bridge.readBytesFromMemory(outPtr, totalFileSize);
}
