// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SolverComputeBackend, detectBestComputeBackend, type NativeGpuBridge } from "../src/gpu/compute-backend.js";

function withGlobals(
  overrides: {
    nativeGpu?: NativeGpuBridge;
    navigatorGpu?: { requestAdapter: () => Promise<unknown> };
  },
  fn: () => Promise<void>,
): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  const hadNative = Object.prototype.hasOwnProperty.call(g, "__modelscript_native_gpu__");
  const prevNative = g.__modelscript_native_gpu__;

  const navDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const hadNavigator = navDesc !== undefined;

  return (async () => {
    try {
      if (overrides.nativeGpu !== undefined) {
        g.__modelscript_native_gpu__ = overrides.nativeGpu;
      } else {
        delete g.__modelscript_native_gpu__;
      }

      if (overrides.navigatorGpu !== undefined) {
        Object.defineProperty(globalThis, "navigator", {
          value: { gpu: overrides.navigatorGpu },
          configurable: true,
          writable: true,
        });
      } else if (hadNavigator) {
        Object.defineProperty(globalThis, "navigator", {
          value: {},
          configurable: true,
          writable: true,
        });
      }

      await fn();
    } finally {
      if (hadNative) {
        g.__modelscript_native_gpu__ = prevNative;
      } else {
        delete g.__modelscript_native_gpu__;
      }

      if (hadNavigator && navDesc) {
        Object.defineProperty(globalThis, "navigator", navDesc);
      } else {
        delete g.navigator;
      }
    }
  })();
}

describe("SolverComputeBackend (packages/simulate/src/gpu/compute-backend.ts)", () => {
  it("falls back to cpu-aot when no native GPU bridge or WebGPU adapter is present", async () => {
    await withGlobals({}, async () => {
      const backend = await detectBestComputeBackend();
      assert.equal(backend.kind, "cpu-aot");
      assert.equal(backend.info.hardwareFp64, true);
      assert.equal(backend.info.isGpu, false);
      backend.dispose();
    });
  });

  it("detects cuda-fp64, hip-fp64, and dawn-webgpu via globalThis.__modelscript_native_gpu__", async () => {
    await withGlobals(
      {
        nativeGpu: {
          backend: "cuda-fp64",
          adapterName: "NVIDIA H100 SXM5",
          hardwareFp64: true,
        },
      },
      async () => {
        const backend = await SolverComputeBackend.detectBestComputeBackend();
        assert.equal(backend.kind, "cuda-fp64");
        assert.equal(backend.info.hardwareFp64, true);
        assert.equal(backend.info.isGpu, true);
        assert.equal(backend.info.adapterName, "NVIDIA H100 SXM5");
      },
    );

    await withGlobals(
      {
        nativeGpu: {
          hipAvailable: true,
          adapterName: "AMD Instinct MI300X",
        },
      },
      async () => {
        const backend = await detectBestComputeBackend();
        assert.equal(backend.kind, "hip-fp64");
        assert.equal(backend.info.hardwareFp64, true);
        assert.equal(backend.info.isGpu, true);
      },
    );

    await withGlobals(
      {
        nativeGpu: {
          dawnAvailable: true,
          adapterName: "Dawn Vulkan",
          hardwareFp64: false,
        },
      },
      async () => {
        const backend = await detectBestComputeBackend();
        assert.equal(backend.kind, "dawn-webgpu");
        assert.equal(backend.info.hardwareFp64, false);
        assert.equal(backend.info.isGpu, true);
      },
    );
  });

  it("detects browser-webgpu via navigator.gpu when no native bridge is present", async () => {
    await withGlobals(
      {
        navigatorGpu: {
          requestAdapter: async () => ({
            info: { description: "Mock WebGPU Adapter" },
            features: { has: (f: string) => f === "shader-f64" },
          }),
        },
      },
      async () => {
        const backend = await detectBestComputeBackend();
        assert.equal(backend.kind, "browser-webgpu");
        assert.equal(backend.info.hardwareFp64, true);
        assert.equal(backend.info.adapterName, "Mock WebGPU Adapter");
        assert.equal(backend.info.isGpu, true);
      },
    );
  });

  it("performs persistent buffer upload/download round-trips with Float64Array and byte offsets", async () => {
    await withGlobals({}, async () => {
      const backend = await detectBestComputeBackend();
      const input = new Float64Array([1.25, -2.5, Math.PI, 42.0, -1e-12, 1e18]);
      const buf = backend.createPersistentBuffer(input.byteLength, "state_vec");

      await buf.upload(input);
      await backend.sync();

      const out = await buf.downloadFloat64();
      assert.equal(out.length, input.length);
      for (let i = 0; i < input.length; i++) {
        assert.equal(out[i], input[i]);
      }

      // Partial offset overwrite and partial readback
      const patch = new Float64Array([99.5, -100.25]);
      await buf.upload(patch, 2 * Float64Array.BYTES_PER_ELEMENT);
      const slice = await buf.downloadFloat64(2 * Float64Array.BYTES_PER_ELEMENT, 2);
      assert.deepEqual(Array.from(slice), [99.5, -100.25]);

      // Bounds validation
      await assert.rejects(() => buf.upload(new Uint8Array(input.byteLength + 1)), RangeError);
      await assert.rejects(() => buf.download(0, input.byteLength + 8), RangeError);

      // Post-destroy guard
      buf.destroy();
      assert.equal(buf.destroyed, true);
      await assert.rejects(() => buf.download(), /destroyed/);
      backend.dispose();
    });
  });

  it("delegates persistent buffer operations to native GPU bridge when provided", async () => {
    const store = new Map<number, Uint8Array>();
    let nextHandle = 1;
    let syncCount = 0;
    let destroyCount = 0;

    const nativeBridge: NativeGpuBridge = {
      backend: "cuda-fp64",
      adapterName: "Mock CUDA Driver",
      hardwareFp64: true,
      createBuffer(byteLength: number) {
        const h = nextHandle++;
        store.set(h, new Uint8Array(byteLength));
        return h;
      },
      upload(handle, data, byteOffset) {
        const mem = store.get(Number(handle));
        assert.ok(mem);
        mem.set(data, byteOffset);
      },
      download(handle, byteOffset, byteLength) {
        const mem = store.get(Number(handle));
        assert.ok(mem);
        return mem.slice(byteOffset, byteOffset + byteLength);
      },
      sync() {
        syncCount++;
      },
      destroyBuffer(handle) {
        store.delete(Number(handle));
        destroyCount++;
      },
    };

    await withGlobals({ nativeGpu: nativeBridge }, async () => {
      const backend = await detectBestComputeBackend();
      assert.equal(backend.kind, "cuda-fp64");

      const payload = new Float64Array([0.1, 0.2, 0.3, 0.4]);
      const buf = backend.createPersistentBuffer(payload.byteLength, "cuda_state");
      await buf.upload(payload);
      await backend.sync();
      assert.equal(syncCount, 1);

      const roundTrip = await buf.downloadFloat64();
      assert.deepEqual(Array.from(roundTrip), Array.from(payload));

      backend.dispose();
      assert.equal(destroyCount, 1);
      assert.equal(store.size, 0);
    });
  });

  it("delegates compileKernel and launchKernel through a mock cuda-fp64 native bridge", async () => {
    const store = new Map<number, Uint8Array>();
    const compiled = new Map<string, string>();
    const launches: Array<{
      name: string;
      grid: [number, number, number];
      block: [number, number, number];
      bufferHandles: unknown[];
    }> = [];
    let nextHandle = 101;

    const nativeBridge: NativeGpuBridge = {
      backend: "cuda-fp64",
      adapterName: "Mock CUDA FP64 NVRTC",
      hardwareFp64: true,
      createBuffer(byteLength: number) {
        const h = nextHandle++;
        store.set(h, new Uint8Array(byteLength));
        return h;
      },
      upload(handle, data, byteOffset) {
        const mem = store.get(Number(handle));
        assert.ok(mem);
        mem.set(data, byteOffset);
      },
      download(handle, byteOffset, byteLength) {
        const mem = store.get(Number(handle));
        assert.ok(mem);
        return mem.slice(byteOffset, byteOffset + byteLength);
      },
      destroyBuffer(handle) {
        store.delete(Number(handle));
      },
      async compileKernel(name, source) {
        compiled.set(name, source);
      },
      async launchKernel(name, grid, block, bufferHandles) {
        assert.ok(compiled.has(name), `Expected '${name}' to be compiled before launch`);
        launches.push({ name, grid, block, bufferHandles });

        // Simulate FP64 scale-by-2 kernel: out[i] = 2.0 * in[i]
        const inMem = store.get(Number(bufferHandles[0]));
        const outMem = store.get(Number(bufferHandles[1]));
        assert.ok(inMem && outMem);
        const inF64 = new Float64Array(inMem.buffer, inMem.byteOffset, inMem.byteLength / 8);
        const outF64 = new Float64Array(outMem.buffer, outMem.byteOffset, outMem.byteLength / 8);
        for (let i = 0; i < inF64.length; i++) {
          outF64[i] = inF64[i] * 2.0;
        }
      },
    };

    await withGlobals({ nativeGpu: nativeBridge }, async () => {
      const backend = await detectBestComputeBackend();
      assert.equal(backend.kind, "cuda-fp64");

      const input = new Float64Array([1.5, -3.25, 4.0, 12.125]);
      const bufIn = backend.createPersistentBuffer(input.byteLength, "in_vec");
      const bufOut = backend.createPersistentBuffer(input.byteLength, "out_vec");
      await bufIn.upload(input);

      // Launching an uncompiled kernel must fail cleanly before reaching the native bridge
      await assert.rejects(
        () => backend.launchKernel("scale_fp64", [1, 1, 1], [64, 1, 1], [bufIn, bufOut]),
        /has not been compiled/,
      );
      assert.equal(launches.length, 0);

      const kernelSrc = `extern "C" __global__ void scale_fp64(const double* in, double* out) {}`;
      await backend.compileKernel("scale_fp64", kernelSrc);
      assert.equal(compiled.get("scale_fp64"), kernelSrc);

      // Invalid grid/block dimensions must fail cleanly
      await assert.rejects(
        () => backend.launchKernel("scale_fp64", [0, 1, 1], [64, 1, 1], [bufIn, bufOut]),
        RangeError,
      );
      await assert.rejects(
        () => backend.launchKernel("scale_fp64", [1, 1, 1], [64, -1, 1], [bufIn, bufOut]),
        RangeError,
      );

      await backend.launchKernel("scale_fp64", [2, 1, 1], [128, 1, 1], [bufIn, bufOut]);
      assert.equal(launches.length, 1);
      assert.deepEqual(launches[0], {
        name: "scale_fp64",
        grid: [2, 1, 1],
        block: [128, 1, 1],
        bufferHandles: [101, 102],
      });

      const out = await bufOut.downloadFloat64();
      assert.deepEqual(Array.from(out), [3.0, -6.5, 8.0, 24.25]);

      // Destroyed buffer guard
      bufOut.destroy();
      await assert.rejects(
        () => backend.launchKernel("scale_fp64", [1, 1, 1], [64, 1, 1], [bufIn, bufOut]),
        /destroyed/,
      );

      backend.dispose();
    });
  });

  it("reports clean errors when compileKernel or launchKernel is called on cpu-aot without native bridge", async () => {
    await withGlobals({}, async () => {
      const backend = await detectBestComputeBackend();
      assert.equal(backend.kind, "cpu-aot");

      await assert.rejects(
        () => backend.compileKernel("fea_amg_fp64", "__global__ void fea_amg_fp64() {}"),
        /not supported on backend 'cpu-aot'/,
      );
      await assert.rejects(
        () => backend.launchKernel("fea_amg_fp64", [1, 1, 1], [64, 1, 1], []),
        /has not been compiled/,
      );

      backend.dispose();
    });
  });
});
