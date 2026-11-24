// SPDX-License-Identifier: AGPL-3.0-or-later
#ifndef MODELSCRIPT_NATIVE_CORE_H_
#define MODELSCRIPT_NATIVE_CORE_H_

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "ms_runtime.h"
#include "ms_simulate.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ms_gpu_capabilities {
  bool dawn_compiled;
  bool dawn_available;
  bool cuda_compiled;
  bool cuda_available;
  bool hip_compiled;
  bool hip_available;
  bool hardware_fp64;
  char backend_name[64];
  char adapter_name[128];
} ms_gpu_capabilities_t;

void ms_native_init(void);
void ms_native_shutdown(void);

w2c_ms__runtime* ms_get_runtime_instance(void);
w2c_ms__simulate* ms_get_simulate_instance(void);

/**
 * Runs an in-process native self-test exercising both wasm2c runtime and simulate kernels.
 * Returns 0 on success, non-zero on failure.
 */
int ms_native_selftest(void);

/**
 * Queries Dawn WebGPU availability and adapter capabilities.
 */
void ms_gpu_dawn_probe(ms_gpu_capabilities_t* out_caps);

/**
 * Queries CUDA / HIP hardware FP64 availability (NVRTC / hipRTC).
 */
void ms_gpu_cuda_hip_probe(ms_gpu_capabilities_t* out_caps);

/**
 * Zero-copy upload from wasm2c linear memory to Dawn GPU buffer (when MS_ENABLE_DAWN=1).
 * Returns 0 on success, -1 if unavailable.
 */
int ms_gpu_dawn_upload_from_wasm_mem(
    void* wgpu_queue,
    void* wgpu_buffer,
    uint64_t buffer_offset,
    const wasm_rt_memory_t* mem,
    uint32_t wasm_ptr,
    size_t byte_length);

/**
 * Dispatches a WGSL compute shader via Dawn WebGPU (when MS_ENABLE_DAWN=1).
 * Returns 0 on success, negative on error or when Dawn is disabled.
 */
int ms_gpu_dawn_dispatch_compute(
    const char* wgsl_source,
    const char* entry_point,
    const void* input_data,
    size_t input_bytes,
    void* output_data,
    size_t output_bytes,
    uint32_t workgroups_x);

/**
 * Compiles an IEEE-754 double (f64) CUDA/HIP kernel in-process via NVRTC/hipRTC.
 * Returns 0 on success, -1 if unavailable or compilation failed.
 */
int ms_gpu_fp64_compile_kernel(
    const char* source_code,
    const char* kernel_name,
    char* error_buf,
    size_t error_buf_size);

/**
 * Compiles and executes a batched IEEE-754 double (f64) CUDA/HIP DAE residual kernel
 * via NVRTC/CUDA Driver API or hipRTC/HIP runtime.
 * Returns 0 on success, negative on error or when CUDA/HIP is disabled.
 */
int ms_gpu_fp64_execute_batch(
    const char* source_code,
    const char* kernel_name,
    const double* host_states,
    double* host_residuals,
    int n_vars,
    int n_eqs,
    int batch_size,
    double sim_time,
    char* error_buf,
    size_t error_buf_size);

/**
 * Returns 1 if native SUNDIALS CVODE was compiled into libmodelscript_native, 0 otherwise.
 */
int ms_sundials_native_available(void);

#ifdef __cplusplus
}
#endif

#endif  // MODELSCRIPT_NATIVE_CORE_H_
