<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/native`

Platform-native compilation layer for ModelScript Desktop VS Code extensions and Cloud HPC clusters.

## Architecture

- **`wasm2c` CPU Kernels:** Transpiles `@modelscript/runtime` and `@modelscript/simulate` AssemblyScript targets (`asbuild:native`) into portable C99 compiled with native SIMD (`AVX2`/`FMA` on x86_64, `NEON` on ARM64, `-march=native` on HPC).
- **Dawn WebGPU (`MS_ENABLE_DAWN=ON`):** Native C++ WebGPU runtime targeting Metal (macOS), DirectX 12 (Windows), and headless Vulkan (Linux/HPC) with zero-copy uploads from `wasm2c` linear memory.
- **Hardware FP64 (`MS_ENABLE_CUDA=ON` / `MS_ENABLE_HIP=ON`):** In-process `NVRTC` / `hipRTC` compilation of IEEE-754 `double` GPU kernels emitted by `cuda-codegen.ts` for datacenter GPUs (A100/H100/MI300X).
- **Browser / Web Isolation:** Conditional `package.json#exports` resolves `"browser"` to `./dist/browser-stub.js` so `apps/web`, `apps/docs`, and `modelscript-web.vsix` stay 100% pure WASM.

## Build Commands

```bash
# Transpile AssemblyScript native targets → C99 + N-API bindings, then compile with CMake
pnpm --filter @modelscript/native run build:native

# Build TypeScript loader
pnpm --filter @modelscript/native run build

# Run native vs WASM bit-exact parity tests
npx tsx --test packages/native/tests/native-parity.test.ts
```
