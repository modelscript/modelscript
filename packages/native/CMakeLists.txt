cmake_minimum_required(VERSION 3.20)
project(modelscript_native LANGUAGES C CXX)

if(NOT MSVC)
  set(CMAKE_C_STANDARD 11)
endif()
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

option(MS_BUILD_NAPI "Build Node.js N-API .node addon" ON)
option(MS_BUILD_HPC_WORKER "Build standalone msx-hpc-worker CLI executable" ON)
option(MS_ENABLE_DAWN "Link Dawn native WebGPU runtime" OFF)
option(MS_ENABLE_CUDA "Enable NVIDIA CUDA / NVRTC hardware FP64 GPU backend" OFF)
option(MS_ENABLE_HIP "Enable AMD HIP / hipRTC hardware FP64 GPU backend" OFF)
option(MS_ENABLE_SUNDIALS "Link native SUNDIALS CVODE library" OFF)
option(MS_HPC_NATIVE_ARCH "Compile with -march=native for HPC compute nodes" OFF)

set(GEN_DIR "${CMAKE_CURRENT_SOURCE_DIR}/generated")
set(WASM2C_RT_DIR "${GEN_DIR}/wasm2c_rt")

if(NOT EXISTS "${GEN_DIR}/ms_runtime.c" OR NOT EXISTS "${GEN_DIR}/ms_simulate.c")
  message(FATAL_ERROR "Missing generated wasm2c C files in ${GEN_DIR}. Run: npx tsx scripts/build/wasm2c-codegen.ts")
endif()

# Core wasm2c + GPU static library
add_library(modelscript_native_core STATIC
  "${WASM2C_RT_DIR}/wasm-rt-impl.c"
  "${WASM2C_RT_DIR}/wasm-rt-mem-impl.c"
  "${WASM2C_RT_DIR}/wasm-rt-exceptions-impl.c"
  "${GEN_DIR}/ms_runtime.c"
  "${GEN_DIR}/ms_simulate.c"
  "src/ms_native_core.c"
  "src/ms_sundials_native.c"
  "src/gpu_dawn.cpp"
  "src/gpu_cuda_hip.cpp"
)

if(EXISTS "${GEN_DIR}/simde_include.cmake")
  include("${GEN_DIR}/simde_include.cmake")
endif()

target_include_directories(modelscript_native_core PUBLIC
  "${CMAKE_CURRENT_SOURCE_DIR}/src"
  "${GEN_DIR}"
  "${WASM2C_RT_DIR}"
)
if(DEFINED MS_SIMDE_INCLUDE_DIR)
  target_include_directories(modelscript_native_core PUBLIC "${MS_SIMDE_INCLUDE_DIR}")
endif()

# Optimization & SIMD flags
if(MSVC)
  target_compile_options(modelscript_native_core PRIVATE /O2 /wd4244 /wd4267 /wd4146)
else()
  target_compile_options(modelscript_native_core PRIVATE
    -O3
    -Wno-unused-function
    -Wno-unused-variable
    -Wno-unused-but-set-variable
    $<$<COMPILE_LANGUAGE:C>:-Wno-incompatible-pointer-types>
  )
  if(MS_HPC_NATIVE_ARCH)
    target_compile_options(modelscript_native_core PRIVATE -march=native)
  elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|AMD64")
    target_compile_options(modelscript_native_core PRIVATE -msse4.2 -mavx2 -mfma)
  endif()
endif()

if(UNIX AND NOT APPLE)
  target_link_libraries(modelscript_native_core PUBLIC m pthread dl)
elseif(APPLE)
  target_link_libraries(modelscript_native_core PUBLIC m pthread)
endif()

# Optional Dawn WebGPU linkage (prebuilt libwebgpu_dawn via DAWN_DIR or fetch-dawn.ts)
if(MS_ENABLE_DAWN)
  if(EXISTS "${GEN_DIR}/dawn_paths.cmake")
    include("${GEN_DIR}/dawn_paths.cmake")
  endif()
  target_compile_definitions(modelscript_native_core PUBLIC MS_ENABLE_DAWN=1)
  if(DEFINED DAWN_INCLUDE_DIR)
    target_include_directories(modelscript_native_core PUBLIC "${DAWN_INCLUDE_DIR}")
  endif()
  if(DEFINED DAWN_LIBRARY)
    target_link_libraries(modelscript_native_core PUBLIC "${DAWN_LIBRARY}")
  endif()
endif()

# Optional NVIDIA CUDA / NVRTC hardware FP64 linkage
if(MS_ENABLE_CUDA)
  find_package(CUDAToolkit REQUIRED)
  target_compile_definitions(modelscript_native_core PUBLIC MS_ENABLE_CUDA=1)
  target_link_libraries(modelscript_native_core PUBLIC CUDA::cuda_driver CUDA::nvrtc)
endif()

# Optional AMD HIP / hipRTC hardware FP64 linkage
if(MS_ENABLE_HIP)
  find_package(hip REQUIRED)
  target_compile_definitions(modelscript_native_core PUBLIC MS_ENABLE_HIP=1)
  target_link_libraries(modelscript_native_core PUBLIC hip::host hiprtc)
endif()

# Optional native SUNDIALS CVODE linkage
if(MS_ENABLE_SUNDIALS)
  find_package(SUNDIALS QUIET COMPONENTS cvode nvecserial)
  if(SUNDIALS_FOUND)
    target_compile_definitions(modelscript_native_core PUBLIC MS_ENABLE_SUNDIALS=1)
    target_link_libraries(modelscript_native_core PUBLIC SUNDIALS::cvode SUNDIALS::nvecserial)
  else()
    find_library(SUNDIALS_CVODE_LIB sundials_cvode)
    find_library(SUNDIALS_NVEC_LIB sundials_nvecserial)
    if(SUNDIALS_CVODE_LIB AND SUNDIALS_NVEC_LIB)
      target_compile_definitions(modelscript_native_core PUBLIC MS_ENABLE_SUNDIALS=1)
      target_link_libraries(modelscript_native_core PUBLIC "${SUNDIALS_CVODE_LIB}" "${SUNDIALS_NVEC_LIB}")
    else()
      message(WARNING "MS_ENABLE_SUNDIALS=ON requested but libsundials_cvode not found; building without native SUNDIALS")
    endif()
  endif()
endif()

# 1. Node.js N-API .node addon (Desktop VS Code + Node CLI/SDK)
if(MS_BUILD_NAPI)
  if(NOT DEFINED NODE_INCLUDE_DIR)
    execute_process(
      COMMAND node -p "require('path').resolve(process.execPath, '..', '..', 'include', 'node')"
      OUTPUT_VARIABLE NODE_INCLUDE_DIR
      OUTPUT_STRIP_TRAILING_WHITESPACE
    )
  endif()

  add_library(modelscript_native SHARED
    "src/ms_napi_addon.c"
    "${GEN_DIR}/ms_runtime_napi.c"
    "${GEN_DIR}/ms_simulate_napi.c"
  )
  set_target_properties(modelscript_native PROPERTIES
    PREFIX ""
    SUFFIX ".node"
  )
  target_include_directories(modelscript_native PRIVATE "${NODE_INCLUDE_DIR}")
  target_compile_definitions(modelscript_native PRIVATE NAPI_VERSION=8)
  target_link_libraries(modelscript_native PRIVATE modelscript_native_core)

  if(APPLE)
    target_link_options(modelscript_native PRIVATE -undefined dynamic_lookup)
  elseif(WIN32)
    if(DEFINED NODE_LIB_FILE)
      target_link_libraries(modelscript_native PRIVATE "${NODE_LIB_FILE}")
    endif()
  endif()
endif()

# 2. Standalone Cloud HPC Worker ELF binary (no Node.js dependency)
if(MS_BUILD_HPC_WORKER)
  add_executable(msx-hpc-worker "src/hpc_worker_main.cpp")
  target_link_libraries(msx-hpc-worker PRIVATE modelscript_native_core)
endif()
