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
 * Opaque handle for a persistent GPU compute session (CUDA Driver API, HIP Runtime,
 * or host-memory fallback when neither GPU backend is compiled in).
 */
typedef struct ms_gpu_session ms_gpu_session_t;

/**
 * Creates a persistent GPU compute session on `device_id`.
 * Returns NULL on failure and writes a diagnostic message to `error_buf` if provided.
 */
ms_gpu_session_t* ms_gpu_session_create(
    int device_id,
    char* error_buf,
    size_t error_buf_size);

/**
 * Destroys a persistent GPU session and releases all tracked device allocations.
 */
void ms_gpu_session_destroy(ms_gpu_session_t* session);

/**
 * Allocates a persistent device buffer of `byte_size` bytes within `session`.
 * Returns a non-zero buffer handle on success, or 0 on failure.
 */
uint64_t ms_gpu_session_alloc(ms_gpu_session_t* session, size_t byte_size);

/**
 * Uploads `byte_size` bytes from `host_src` to buffer `handle` at `byte_offset`.
 * Returns 0 on success, negative on error.
 */
int ms_gpu_session_upload(
    ms_gpu_session_t* session,
    uint64_t handle,
    size_t byte_offset,
    const void* host_src,
    size_t byte_size);

/**
 * Downloads `byte_size` bytes from buffer `handle` at `byte_offset` into `host_dst`.
 * Returns 0 on success, negative on error.
 */
int ms_gpu_session_download(
    ms_gpu_session_t* session,
    uint64_t handle,
    size_t byte_offset,
    void* host_dst,
    size_t byte_size);

/**
 * Synchronizes all pending GPU operations in `session`.
 * Returns 0 on success, negative on error.
 */
int ms_gpu_session_sync(ms_gpu_session_t* session);

/**
 * Compiles a CUDA/HIP GPU kernel via NVRTC/hipRTC and registers it under `kernel_name`
 * within `session` (or validates and registers it in the host registry when CUDA/HIP is disabled).
 * Returns 0 on success, negative on error with a diagnostic in `error_buf`.
 */
int ms_gpu_session_compile_kernel(
    ms_gpu_session_t* session,
    const char* kernel_name,
    const char* source_code,
    char* error_buf,
    size_t error_buf_size);

/**
 * Launches a previously compiled kernel registered under `kernel_name` in `session`
 * with the specified 3D grid/block dimensions and session buffer handle arguments.
 * Returns 0 on success, negative on error with a diagnostic in `error_buf`.
 */
int ms_gpu_session_launch_kernel(
    ms_gpu_session_t* session,
    const char* kernel_name,
    uint32_t grid_x,
    uint32_t grid_y,
    uint32_t grid_z,
    uint32_t block_x,
    uint32_t block_y,
    uint32_t block_z,
    const uint32_t* buffer_handles,
    uint32_t num_buffers,
    char* error_buf,
    size_t error_buf_size);

typedef struct ms_mpi_capabilities {
  bool mpi_compiled;
  bool nccl_compiled;
  int rank;
  int world_size;
} ms_mpi_capabilities_t;

/**
 * Queries MPI / NCCL distributed HPC capabilities and current rank/world_size.
 */
void ms_mpi_probe(ms_mpi_capabilities_t* out_caps);

/**
 * Returns 1 if native SUNDIALS CVODE was compiled into libmodelscript_native, 0 otherwise.
 */
int ms_sundials_native_available(void);

#ifdef __cplusplus
}
#endif

#endif  // MODELSCRIPT_NATIVE_CORE_H_
