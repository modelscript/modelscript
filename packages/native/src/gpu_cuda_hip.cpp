// SPDX-License-Identifier: AGPL-3.0-or-later
#include "ms_native_core.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <vector>

#ifdef MS_ENABLE_CUDA
#include <cuda.h>
#include <nvrtc.h>
#endif

#ifdef MS_ENABLE_HIP
#include <hip/hip_runtime.h>
#include <hip/hiprtc.h>
#endif

namespace {

void set_error(char* error_buf, size_t error_buf_size, const char* msg) {
  if (error_buf && error_buf_size > 0 && msg) {
    std::snprintf(error_buf, error_buf_size, "%s", msg);
  }
}

#if defined(MS_ENABLE_CUDA) || defined(MS_ENABLE_HIP)
void copy_log_to_error_buf(
    const std::vector<char>& log,
    char* error_buf,
    size_t error_buf_size) {
  if (!error_buf || error_buf_size == 0 || log.empty()) return;
  const size_t copy_len = std::min(log.size(), error_buf_size - 1);
  std::memcpy(error_buf, log.data(), copy_len);
  error_buf[copy_len] = '\0';
}
#endif

}  // namespace

extern "C" {

void ms_gpu_cuda_hip_probe(ms_gpu_capabilities_t* out_caps) {
  if (!out_caps) return;
#ifdef MS_ENABLE_CUDA
  out_caps->cuda_compiled = true;
  if (cuInit(0) == CUDA_SUCCESS) {
    int count = 0;
    if (cuDeviceGetCount(&count) == CUDA_SUCCESS && count > 0) {
      CUdevice dev;
      if (cuDeviceGet(&dev, 0) == CUDA_SUCCESS) {
        char name[128] = {0};
        cuDeviceGetName(name, sizeof(name), dev);
        out_caps->cuda_available = true;
        out_caps->hardware_fp64 = true;
        std::strncpy(out_caps->backend_name, "cuda-nvrtc-fp64", sizeof(out_caps->backend_name) - 1);
        std::strncpy(out_caps->adapter_name, name, sizeof(out_caps->adapter_name) - 1);
      }
    }
  }
#elif defined(MS_ENABLE_HIP)
  out_caps->hip_compiled = true;
  int count = 0;
  if (hipGetDeviceCount(&count) == hipSuccess && count > 0) {
    hipDeviceProp_t prop;
    if (hipGetDeviceProperties(&prop, 0) == hipSuccess) {
      out_caps->hip_available = true;
      out_caps->hardware_fp64 = true;
      std::strncpy(out_caps->backend_name, "hip-hiprtc-fp64", sizeof(out_caps->backend_name) - 1);
      std::strncpy(out_caps->adapter_name, prop.name, sizeof(out_caps->adapter_name) - 1);
    }
  }
#else
  out_caps->cuda_compiled = false;
  out_caps->cuda_available = false;
  out_caps->hip_compiled = false;
  out_caps->hip_available = false;
#endif
}

int ms_gpu_fp64_compile_kernel(
    const char* source_code,
    const char* kernel_name,
    char* error_buf,
    size_t error_buf_size) {
#ifdef MS_ENABLE_CUDA
  if (!source_code || !kernel_name) {
    set_error(error_buf, error_buf_size, "Invalid null source_code or kernel_name");
    return -1;
  }
  nvrtcProgram prog = nullptr;
  if (nvrtcCreateProgram(&prog, source_code, "ms_dae_fp64.cu", 0, nullptr, nullptr) != NVRTC_SUCCESS) {
    set_error(error_buf, error_buf_size, "nvrtcCreateProgram failed");
    return -2;
  }
  const char* opts[] = {"--fmad=true", "--std=c++17"};
  const nvrtcResult res = nvrtcCompileProgram(prog, 2, opts);
  if (res != NVRTC_SUCCESS) {
    size_t log_size = 0;
    nvrtcGetProgramLogSize(prog, &log_size);
    if (log_size > 0) {
      std::vector<char> log(log_size);
      if (nvrtcGetProgramLog(prog, log.data()) == NVRTC_SUCCESS) {
        copy_log_to_error_buf(log, error_buf, error_buf_size);
      }
    } else {
      set_error(error_buf, error_buf_size, nvrtcGetErrorString(res));
    }
    nvrtcDestroyProgram(&prog);
    return -3;
  }
  nvrtcDestroyProgram(&prog);
  return 0;
#elif defined(MS_ENABLE_HIP)
  if (!source_code || !kernel_name) {
    set_error(error_buf, error_buf_size, "Invalid null source_code or kernel_name");
    return -1;
  }
  hiprtcProgram prog = nullptr;
  if (hiprtcCreateProgram(&prog, source_code, "ms_dae_fp64.hip", 0, nullptr, nullptr) != HIPRTC_SUCCESS) {
    set_error(error_buf, error_buf_size, "hiprtcCreateProgram failed");
    return -2;
  }
  const char* opts[] = {"-std=c++17"};
  const hiprtcResult res = hiprtcCompileProgram(prog, 1, opts);
  if (res != HIPRTC_SUCCESS) {
    size_t log_size = 0;
    hiprtcGetProgramLogSize(prog, &log_size);
    if (log_size > 0) {
      std::vector<char> log(log_size);
      if (hiprtcGetProgramLog(prog, log.data()) == HIPRTC_SUCCESS) {
        copy_log_to_error_buf(log, error_buf, error_buf_size);
      }
    } else {
      set_error(error_buf, error_buf_size, hiprtcGetErrorString(res));
    }
    hiprtcDestroyProgram(&prog);
    return -3;
  }
  hiprtcDestroyProgram(&prog);
  return 0;
#else
  (void)source_code;
  (void)kernel_name;
  set_error(error_buf, error_buf_size, "CUDA/HIP NVRTC backend not enabled in this build");
  return -1;
#endif
}

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
    size_t error_buf_size) {
#ifdef MS_ENABLE_CUDA
  if (!source_code || !kernel_name || !host_states || !host_residuals ||
      n_vars <= 0 || n_eqs <= 0 || batch_size <= 0) {
    set_error(error_buf, error_buf_size, "Invalid arguments to ms_gpu_fp64_execute_batch");
    return -1;
  }

  // 1. Compile CUDA C++ FP64 kernel to PTX via NVRTC
  nvrtcProgram prog = nullptr;
  if (nvrtcCreateProgram(&prog, source_code, "ms_dae_fp64.cu", 0, nullptr, nullptr) != NVRTC_SUCCESS) {
    set_error(error_buf, error_buf_size, "nvrtcCreateProgram failed");
    return -2;
  }
  const char* opts[] = {"--fmad=true", "--std=c++17"};
  const nvrtcResult compile_res = nvrtcCompileProgram(prog, 2, opts);
  if (compile_res != NVRTC_SUCCESS) {
    size_t log_size = 0;
    nvrtcGetProgramLogSize(prog, &log_size);
    if (log_size > 0) {
      std::vector<char> log(log_size);
      if (nvrtcGetProgramLog(prog, log.data()) == NVRTC_SUCCESS) {
        copy_log_to_error_buf(log, error_buf, error_buf_size);
      }
    } else {
      set_error(error_buf, error_buf_size, nvrtcGetErrorString(compile_res));
    }
    nvrtcDestroyProgram(&prog);
    return -3;
  }

  size_t ptx_size = 0;
  if (nvrtcGetPTXSize(prog, &ptx_size) != NVRTC_SUCCESS || ptx_size == 0) {
    nvrtcDestroyProgram(&prog);
    set_error(error_buf, error_buf_size, "nvrtcGetPTXSize failed");
    return -4;
  }
  std::vector<char> ptx(ptx_size);
  if (nvrtcGetPTX(prog, ptx.data()) != NVRTC_SUCCESS) {
    nvrtcDestroyProgram(&prog);
    set_error(error_buf, error_buf_size, "nvrtcGetPTX failed");
    return -4;
  }
  nvrtcDestroyProgram(&prog);

  // 2. Initialize CUDA Driver API context
  if (cuInit(0) != CUDA_SUCCESS) {
    set_error(error_buf, error_buf_size, "cuInit failed");
    return -5;
  }
  CUdevice dev = 0;
  if (cuDeviceGet(&dev, 0) != CUDA_SUCCESS) {
    set_error(error_buf, error_buf_size, "cuDeviceGet(0) failed");
    return -5;
  }
  CUcontext ctx = nullptr;
  bool retained_primary_ctx = false;
  if (cuCtxGetCurrent(&ctx) != CUDA_SUCCESS || ctx == nullptr) {
    if (cuDevicePrimaryCtxRetain(&ctx, dev) != CUDA_SUCCESS) {
      set_error(error_buf, error_buf_size, "cuDevicePrimaryCtxRetain failed");
      return -5;
    }
    if (cuCtxPushCurrent(ctx) != CUDA_SUCCESS) {
      cuDevicePrimaryCtxRelease(dev);
      set_error(error_buf, error_buf_size, "cuCtxPushCurrent failed");
      return -5;
    }
    retained_primary_ctx = true;
  }

  CUmodule mod = nullptr;
  CUfunction fn = nullptr;
  CUdeviceptr d_states = 0;
  CUdeviceptr d_residuals = 0;
  int rc = 0;

  const size_t states_bytes =
      static_cast<size_t>(batch_size) * static_cast<size_t>(n_vars) * sizeof(double);
  const size_t residuals_bytes =
      static_cast<size_t>(batch_size) * static_cast<size_t>(n_eqs) * sizeof(double);

  // 3. Load PTX module and resolve kernel entry point
  if (cuModuleLoadDataEx(&mod, ptx.data(), 0, nullptr, nullptr) != CUDA_SUCCESS) {
    set_error(error_buf, error_buf_size, "cuModuleLoadDataEx failed");
    rc = -6;
  }
  if (rc == 0 && cuModuleGetFunction(&fn, mod, kernel_name) != CUDA_SUCCESS) {
    set_error(error_buf, error_buf_size, "cuModuleGetFunction failed");
    rc = -7;
  }

  // 4. Allocate device buffers and copy host states HtoD
  if (rc == 0 && cuMemAlloc(&d_states, states_bytes) != CUDA_SUCCESS) {
    set_error(error_buf, error_buf_size, "cuMemAlloc(d_states) failed");
    rc = -8;
  }
  if (rc == 0 && cuMemAlloc(&d_residuals, residuals_bytes) != CUDA_SUCCESS) {
    set_error(error_buf, error_buf_size, "cuMemAlloc(d_residuals) failed");
    rc = -8;
  }
  if (rc == 0 && cuMemcpyHtoD(d_states, host_states, states_bytes) != CUDA_SUCCESS) {
    set_error(error_buf, error_buf_size, "cuMemcpyHtoD failed");
    rc = -9;
  }

  // 5. Launch FP64 batch kernel
  if (rc == 0) {
    const unsigned int block_x = 256U;
    const unsigned int grid_x =
        (static_cast<unsigned int>(batch_size) + block_x - 1U) / block_x;
    void* args[] = {&d_states, &d_residuals, &n_vars, &n_eqs, &batch_size, &sim_time};
    if (cuLaunchKernel(
            fn,
            grid_x, 1U, 1U,
            block_x, 1U, 1U,
            0U, nullptr,
            args, nullptr) != CUDA_SUCCESS) {
      set_error(error_buf, error_buf_size, "cuLaunchKernel failed");
      rc = -10;
    }
  }
  if (rc == 0 && cuCtxSynchronize() != CUDA_SUCCESS) {
    set_error(error_buf, error_buf_size, "cuCtxSynchronize failed");
    rc = -11;
  }

  // 6. Copy residuals DtoH
  if (rc == 0 && cuMemcpyDtoH(host_residuals, d_residuals, residuals_bytes) != CUDA_SUCCESS) {
    set_error(error_buf, error_buf_size, "cuMemcpyDtoH failed");
    rc = -12;
  }

  // 7. Cleanup device allocations, module, and context
  if (d_residuals) cuMemFree(d_residuals);
  if (d_states) cuMemFree(d_states);
  if (mod) cuModuleUnload(mod);
  if (retained_primary_ctx) {
    CUcontext popped = nullptr;
    cuCtxPopCurrent(&popped);
    cuDevicePrimaryCtxRelease(dev);
  }
  return rc;

#elif defined(MS_ENABLE_HIP)
  if (!source_code || !kernel_name || !host_states || !host_residuals ||
      n_vars <= 0 || n_eqs <= 0 || batch_size <= 0) {
    set_error(error_buf, error_buf_size, "Invalid arguments to ms_gpu_fp64_execute_batch");
    return -1;
  }

  // 1. Compile HIP C++ FP64 kernel to HSACO code object via hipRTC
  hiprtcProgram prog = nullptr;
  if (hiprtcCreateProgram(&prog, source_code, "ms_dae_fp64.hip", 0, nullptr, nullptr) != HIPRTC_SUCCESS) {
    set_error(error_buf, error_buf_size, "hiprtcCreateProgram failed");
    return -2;
  }
  const char* opts[] = {"-std=c++17"};
  const hiprtcResult compile_res = hiprtcCompileProgram(prog, 1, opts);
  if (compile_res != HIPRTC_SUCCESS) {
    size_t log_size = 0;
    hiprtcGetProgramLogSize(prog, &log_size);
    if (log_size > 0) {
      std::vector<char> log(log_size);
      if (hiprtcGetProgramLog(prog, log.data()) == HIPRTC_SUCCESS) {
        copy_log_to_error_buf(log, error_buf, error_buf_size);
      }
    } else {
      set_error(error_buf, error_buf_size, hiprtcGetErrorString(compile_res));
    }
    hiprtcDestroyProgram(&prog);
    return -3;
  }

  size_t code_size = 0;
  if (hiprtcGetCodeSize(prog, &code_size) != HIPRTC_SUCCESS || code_size == 0) {
    hiprtcDestroyProgram(&prog);
    set_error(error_buf, error_buf_size, "hiprtcGetCodeSize failed");
    return -4;
  }
  std::vector<char> hsaco(code_size);
  if (hiprtcGetCode(prog, hsaco.data()) != HIPRTC_SUCCESS) {
    hiprtcDestroyProgram(&prog);
    set_error(error_buf, error_buf_size, "hiprtcGetCode failed");
    return -4;
  }
  hiprtcDestroyProgram(&prog);

  // 2. Select HIP device and load HSACO module
  if (hipSetDevice(0) != hipSuccess) {
    set_error(error_buf, error_buf_size, "hipSetDevice(0) failed");
    return -5;
  }

  hipModule_t mod = nullptr;
  hipFunction_t fn = nullptr;
  void* d_states = nullptr;
  void* d_residuals = nullptr;
  int rc = 0;

  const size_t states_bytes =
      static_cast<size_t>(batch_size) * static_cast<size_t>(n_vars) * sizeof(double);
  const size_t residuals_bytes =
      static_cast<size_t>(batch_size) * static_cast<size_t>(n_eqs) * sizeof(double);

  if (hipModuleLoadData(&mod, hsaco.data()) != hipSuccess) {
    set_error(error_buf, error_buf_size, "hipModuleLoadData failed");
    rc = -6;
  }
  if (rc == 0 && hipModuleGetFunction(&fn, mod, kernel_name) != hipSuccess) {
    set_error(error_buf, error_buf_size, "hipModuleGetFunction failed");
    rc = -7;
  }

  // 3. Allocate device memory and copy host states HtoD
  if (rc == 0 && hipMalloc(&d_states, states_bytes) != hipSuccess) {
    set_error(error_buf, error_buf_size, "hipMalloc(d_states) failed");
    rc = -8;
  }
  if (rc == 0 && hipMalloc(&d_residuals, residuals_bytes) != hipSuccess) {
    set_error(error_buf, error_buf_size, "hipMalloc(d_residuals) failed");
    rc = -8;
  }
  if (rc == 0 && hipMemcpy(d_states, host_states, states_bytes, hipMemcpyHostToDevice) != hipSuccess) {
    set_error(error_buf, error_buf_size, "hipMemcpy(HostToDevice) failed");
    rc = -9;
  }

  // 4. Launch FP64 batch kernel
  if (rc == 0) {
    const unsigned int block_x = 256U;
    const unsigned int grid_x =
        (static_cast<unsigned int>(batch_size) + block_x - 1U) / block_x;
    void* args[] = {&d_states, &d_residuals, &n_vars, &n_eqs, &batch_size, &sim_time};
    if (hipModuleLaunchKernel(
            fn,
            grid_x, 1U, 1U,
            block_x, 1U, 1U,
            0U, nullptr,
            args, nullptr) != hipSuccess) {
      set_error(error_buf, error_buf_size, "hipModuleLaunchKernel failed");
      rc = -10;
    }
  }
  if (rc == 0 && hipDeviceSynchronize() != hipSuccess) {
    set_error(error_buf, error_buf_size, "hipDeviceSynchronize failed");
    rc = -11;
  }

  // 5. Copy residuals DtoH
  if (rc == 0 && hipMemcpy(host_residuals, d_residuals, residuals_bytes, hipMemcpyDeviceToHost) != hipSuccess) {
    set_error(error_buf, error_buf_size, "hipMemcpy(DeviceToHost) failed");
    rc = -12;
  }

  // 6. Cleanup
  if (d_residuals) (void)hipFree(d_residuals);
  if (d_states) (void)hipFree(d_states);
  if (mod) (void)hipModuleUnload(mod);
  return rc;

#else
  (void)source_code;
  (void)kernel_name;
  (void)host_states;
  (void)host_residuals;
  (void)n_vars;
  (void)n_eqs;
  (void)batch_size;
  (void)sim_time;
  set_error(error_buf, error_buf_size, "CUDA/HIP hardware FP64 execution backend not enabled in this build");
  return -1;
#endif
}

}  // extern "C"
