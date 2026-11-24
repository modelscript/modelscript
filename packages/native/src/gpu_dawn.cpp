// SPDX-License-Identifier: AGPL-3.0-or-later
#include "ms_native_core.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>

#ifdef MS_ENABLE_DAWN
#include <webgpu/webgpu.h>

namespace {

constexpr size_t kMinStorageBufferBytes = 4;

inline size_t align_up_4(size_t n) {
  return (n + 3u) & ~size_t(3u);
}

#ifdef WGPU_STRLEN
inline WGPUStringView to_wgpu_string(const char* s) {
  WGPUStringView v;
  v.data = s;
  v.length = s ? WGPU_STRLEN : 0;
  return v;
}

inline void copy_wgpu_string(char* dst, size_t dst_size, WGPUStringView src) {
  if (!dst || dst_size == 0) return;
  dst[0] = '\0';
  if (!src.data) return;
  size_t len = (src.length == WGPU_STRLEN) ? std::strlen(src.data) : src.length;
  if (len >= dst_size) len = dst_size - 1;
  std::memcpy(dst, src.data, len);
  dst[len] = '\0';
}
#else
inline const char* to_wgpu_string(const char* s) {
  return s;
}
#endif

const char* backend_type_to_name(WGPUBackendType backend) {
  switch (backend) {
    case WGPUBackendType_Vulkan:
      return "dawn-vulkan";
    case WGPUBackendType_Metal:
      return "dawn-metal";
    case WGPUBackendType_D3D12:
      return "dawn-d3d12";
    case WGPUBackendType_D3D11:
      return "dawn-d3d11";
    case WGPUBackendType_OpenGL:
    case WGPUBackendType_OpenGLES:
      return "dawn-opengl";
    default:
      return "dawn-webgpu";
  }
}

WGPUAdapter request_adapter_sync(WGPUInstance instance) {
  struct AdapterWaitState {
    WGPUAdapter adapter = nullptr;
    bool done = false;
  };
  AdapterWaitState state;
  WGPURequestAdapterOptions opts = {};
  opts.powerPreference = WGPUPowerPreference_HighPerformance;

#ifdef WGPU_STRLEN
  WGPURequestAdapterCallbackInfo cb_info = {};
  cb_info.mode = WGPUCallbackMode_AllowProcessEvents;
  cb_info.callback = [](WGPURequestAdapterStatus status,
                        WGPUAdapter adapter,
                        WGPUStringView /*message*/,
                        void* ud1,
                        void* /*ud2*/) {
    auto* st = static_cast<AdapterWaitState*>(ud1);
    if (status == WGPURequestAdapterStatus_Success) {
      st->adapter = adapter;
    }
    st->done = true;
  };
  cb_info.userdata1 = &state;
  wgpuInstanceRequestAdapter(instance, &opts, cb_info);
  while (!state.done) {
    wgpuInstanceProcessEvents(instance);
  }
#else
  wgpuInstanceRequestAdapter(
      instance,
      &opts,
      [](WGPURequestAdapterStatus status,
         WGPUAdapter adapter,
         const char* /*message*/,
         void* ud) {
        auto* st = static_cast<AdapterWaitState*>(ud);
        if (status == WGPURequestAdapterStatus_Success) {
          st->adapter = adapter;
        }
        st->done = true;
      },
      &state);
#endif
  return state.adapter;
}

WGPUDevice request_device_sync(WGPUInstance instance, WGPUAdapter adapter) {
  struct DeviceWaitState {
    WGPUDevice device = nullptr;
    bool done = false;
  };
  DeviceWaitState state;
  WGPUDeviceDescriptor desc = {};
  desc.label = to_wgpu_string("modelscript-dawn-device");

#ifdef WGPU_STRLEN
  WGPURequestDeviceCallbackInfo cb_info = {};
  cb_info.mode = WGPUCallbackMode_AllowProcessEvents;
  cb_info.callback = [](WGPURequestDeviceStatus status,
                        WGPUDevice device,
                        WGPUStringView /*message*/,
                        void* ud1,
                        void* /*ud2*/) {
    auto* st = static_cast<DeviceWaitState*>(ud1);
    if (status == WGPURequestDeviceStatus_Success) {
      st->device = device;
    }
    st->done = true;
  };
  cb_info.userdata1 = &state;
  wgpuAdapterRequestDevice(adapter, &desc, cb_info);
  while (!state.done) {
    wgpuInstanceProcessEvents(instance);
  }
#else
  (void)instance;
  wgpuAdapterRequestDevice(
      adapter,
      &desc,
      [](WGPURequestDeviceStatus status,
         WGPUDevice device,
         const char* /*message*/,
         void* ud) {
        auto* st = static_cast<DeviceWaitState*>(ud);
        if (status == WGPURequestDeviceStatus_Success) {
          st->device = device;
        }
        st->done = true;
      },
      &state);
#endif
  return state.device;
}

bool map_buffer_read_sync(WGPUInstance instance, WGPUDevice device, WGPUBuffer buffer, size_t size) {
  struct MapWaitState {
    bool ok = false;
    bool done = false;
  };
  MapWaitState state;

#ifdef WGPU_STRLEN
  (void)device;
  WGPUBufferMapCallbackInfo cb_info = {};
  cb_info.mode = WGPUCallbackMode_AllowProcessEvents;
  cb_info.callback = [](WGPUMapAsyncStatus status,
                        WGPUStringView /*message*/,
                        void* ud1,
                        void* /*ud2*/) {
    auto* st = static_cast<MapWaitState*>(ud1);
    st->ok = (status == WGPUMapAsyncStatus_Success);
    st->done = true;
  };
  cb_info.userdata1 = &state;
  wgpuBufferMapAsync(buffer, WGPUMapMode_Read, 0, size, cb_info);
  while (!state.done) {
    wgpuInstanceProcessEvents(instance);
  }
#else
  (void)instance;
  wgpuBufferMapAsync(
      buffer,
      WGPUMapMode_Read,
      0,
      size,
      [](WGPUBufferMapAsyncStatus status, void* ud) {
        auto* st = static_cast<MapWaitState*>(ud);
        st->ok = (status == WGPUBufferMapAsyncStatus_Success);
        st->done = true;
      },
      &state);
  while (!state.done) {
    wgpuDeviceTick(device);
  }
#endif
  return state.ok;
}

}  // namespace
#endif  // MS_ENABLE_DAWN

extern "C" {

void ms_gpu_dawn_probe(ms_gpu_capabilities_t* out_caps) {
  if (!out_caps) return;
#ifdef MS_ENABLE_DAWN
  out_caps->dawn_compiled = true;
  out_caps->dawn_available = false;

  WGPUInstanceDescriptor desc = {};
  WGPUInstance instance = wgpuCreateInstance(&desc);
  if (!instance) {
    return;
  }

  WGPUAdapter adapter = request_adapter_sync(instance);
  if (!adapter) {
    wgpuInstanceRelease(instance);
    return;
  }

  out_caps->dawn_available = true;

#ifdef WGPU_STRLEN
  WGPUAdapterInfo info = {};
  wgpuAdapterGetInfo(adapter, &info);
  const char* backend = backend_type_to_name(info.backendType);
  std::strncpy(out_caps->backend_name, backend, sizeof(out_caps->backend_name) - 1);
  out_caps->backend_name[sizeof(out_caps->backend_name) - 1] = '\0';

  if (info.device.data && (info.device.length == WGPU_STRLEN ? info.device.data[0] != '\0' : info.device.length > 0)) {
    copy_wgpu_string(out_caps->adapter_name, sizeof(out_caps->adapter_name), info.device);
  } else if (info.description.data &&
             (info.description.length == WGPU_STRLEN ? info.description.data[0] != '\0' : info.description.length > 0)) {
    copy_wgpu_string(out_caps->adapter_name, sizeof(out_caps->adapter_name), info.description);
  } else {
    std::strncpy(out_caps->adapter_name, "Dawn Native WebGPU", sizeof(out_caps->adapter_name) - 1);
    out_caps->adapter_name[sizeof(out_caps->adapter_name) - 1] = '\0';
  }
  wgpuAdapterInfoFreeMembers(info);
#else
  WGPUAdapterProperties props = {};
  wgpuAdapterGetProperties(adapter, &props);
  const char* backend = backend_type_to_name(props.backendType);
  std::strncpy(out_caps->backend_name, backend, sizeof(out_caps->backend_name) - 1);
  out_caps->backend_name[sizeof(out_caps->backend_name) - 1] = '\0';

  const char* name = (props.name && props.name[0]) ? props.name : "Dawn Native WebGPU";
  std::strncpy(out_caps->adapter_name, name, sizeof(out_caps->adapter_name) - 1);
  out_caps->adapter_name[sizeof(out_caps->adapter_name) - 1] = '\0';
#endif

  wgpuAdapterRelease(adapter);
  wgpuInstanceRelease(instance);
#else
  out_caps->dawn_compiled = false;
  out_caps->dawn_available = false;
#endif
}

int ms_gpu_dawn_upload_from_wasm_mem(
    void* wgpu_queue,
    void* wgpu_buffer,
    uint64_t buffer_offset,
    const wasm_rt_memory_t* mem,
    uint32_t wasm_ptr,
    size_t byte_length) {
#ifdef MS_ENABLE_DAWN
  if (!wgpu_queue || !wgpu_buffer || !mem || !mem->data) return -1;
  if ((uint64_t)wasm_ptr > (uint64_t)mem->size ||
      (uint64_t)byte_length > (uint64_t)mem->size - (uint64_t)wasm_ptr) {
    return -2;
  }
  if (byte_length == 0) return 0;

  wgpuQueueWriteBuffer(
      static_cast<WGPUQueue>(wgpu_queue),
      static_cast<WGPUBuffer>(wgpu_buffer),
      buffer_offset,
      mem->data + wasm_ptr,
      byte_length);
  return 0;
#else
  (void)wgpu_queue;
  (void)wgpu_buffer;
  (void)buffer_offset;
  (void)mem;
  (void)wasm_ptr;
  (void)byte_length;
  return -1;
#endif
}

int ms_gpu_dawn_dispatch_compute(
    const char* wgsl_source,
    const char* entry_point,
    const void* input_data,
    size_t input_bytes,
    void* output_data,
    size_t output_bytes,
    uint32_t workgroups_x) {
#ifdef MS_ENABLE_DAWN
  if (!wgsl_source || !entry_point || workgroups_x == 0) return -1;
  if (input_bytes > 0 && !input_data) return -1;
  if (output_bytes > 0 && !output_data) return -1;

  WGPUInstanceDescriptor inst_desc = {};
  WGPUInstance instance = wgpuCreateInstance(&inst_desc);
  if (!instance) return -2;

  WGPUAdapter adapter = request_adapter_sync(instance);
  if (!adapter) {
    wgpuInstanceRelease(instance);
    return -3;
  }

  WGPUDevice device = request_device_sync(instance, adapter);
  if (!device) {
    wgpuAdapterRelease(adapter);
    wgpuInstanceRelease(instance);
    return -4;
  }

  WGPUQueue queue = wgpuDeviceGetQueue(device);
  int rc = 0;

  WGPUShaderModule shader = nullptr;
  WGPUComputePipeline pipeline = nullptr;
  WGPUBindGroupLayout bgl = nullptr;
  WGPUBindGroup bind_group = nullptr;
  WGPUBuffer input_buf = nullptr;
  WGPUBuffer output_buf = nullptr;
  WGPUBuffer readback_buf = nullptr;
  WGPUCommandEncoder encoder = nullptr;
  WGPUCommandBuffer cmd_buf = nullptr;

  do {
    // 1. Compile WGSL via Dawn / Tint
#ifdef WGPU_STRLEN
    WGPUShaderSourceWGSL wgsl_desc = {};
    wgsl_desc.chain.sType = WGPUSType_ShaderSourceWGSL;
    wgsl_desc.code = to_wgpu_string(wgsl_source);
#else
    WGPUShaderModuleWGSLDescriptor wgsl_desc = {};
    wgsl_desc.chain.sType = WGPUSType_ShaderModuleWGSLDescriptor;
    wgsl_desc.code = wgsl_source;
#endif
    WGPUShaderModuleDescriptor sm_desc = {};
    sm_desc.nextInChain = &wgsl_desc.chain;
    sm_desc.label = to_wgpu_string("modelscript-wgsl-compute");
    shader = wgpuDeviceCreateShaderModule(device, &sm_desc);
    if (!shader) {
      rc = -5;
      break;
    }

    // 2. Create compute pipeline with auto bind-group layout
    WGPUComputePipelineDescriptor pipe_desc = {};
    pipe_desc.label = to_wgpu_string("modelscript-compute-pipeline");
    pipe_desc.layout = nullptr;
    pipe_desc.compute.module = shader;
    pipe_desc.compute.entryPoint = to_wgpu_string(entry_point);
    pipeline = wgpuDeviceCreateComputePipeline(device, &pipe_desc);
    if (!pipeline) {
      rc = -6;
      break;
    }

    // 3. Allocate input, output, and staging readback buffers
    const size_t input_buf_size = align_up_4(std::max(input_bytes, kMinStorageBufferBytes));
    const size_t output_buf_size = align_up_4(std::max(output_bytes, kMinStorageBufferBytes));

    WGPUBufferDescriptor in_desc = {};
    in_desc.label = to_wgpu_string("modelscript-input");
    in_desc.size = input_buf_size;
    in_desc.usage = WGPUBufferUsage_Storage | WGPUBufferUsage_CopyDst;
    input_buf = wgpuDeviceCreateBuffer(device, &in_desc);

    WGPUBufferDescriptor out_desc = {};
    out_desc.label = to_wgpu_string("modelscript-output");
    out_desc.size = output_buf_size;
    out_desc.usage = WGPUBufferUsage_Storage | WGPUBufferUsage_CopySrc;
    output_buf = wgpuDeviceCreateBuffer(device, &out_desc);

    WGPUBufferDescriptor rb_desc = {};
    rb_desc.label = to_wgpu_string("modelscript-readback");
    rb_desc.size = output_buf_size;
    rb_desc.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
    readback_buf = wgpuDeviceCreateBuffer(device, &rb_desc);

    if (!input_buf || !output_buf || !readback_buf) {
      rc = -7;
      break;
    }

    if (input_bytes > 0) {
      wgpuQueueWriteBuffer(queue, input_buf, 0, input_data, input_bytes);
    }

    // 4. Bind storage buffers (binding 0 = input, binding 1 = output)
    bgl = wgpuComputePipelineGetBindGroupLayout(pipeline, 0);
    if (!bgl) {
      rc = -8;
      break;
    }

    WGPUBindGroupEntry entries[2] = {};
    entries[0].binding = 0;
    entries[0].buffer = input_buf;
    entries[0].offset = 0;
    entries[0].size = input_buf_size;

    entries[1].binding = 1;
    entries[1].buffer = output_buf;
    entries[1].offset = 0;
    entries[1].size = output_buf_size;

    WGPUBindGroupDescriptor bg_desc = {};
    bg_desc.label = to_wgpu_string("modelscript-compute-bg");
    bg_desc.layout = bgl;
    bg_desc.entryCount = 2;
    bg_desc.entries = entries;
    bind_group = wgpuDeviceCreateBindGroup(device, &bg_desc);
    if (!bind_group) {
      rc = -9;
      break;
    }

    // 5. Encode compute pass + output readback copy
    WGPUCommandEncoderDescriptor enc_desc = {};
    enc_desc.label = to_wgpu_string("modelscript-compute-encoder");
    encoder = wgpuDeviceCreateCommandEncoder(device, &enc_desc);
    if (!encoder) {
      rc = -10;
      break;
    }

    WGPUComputePassDescriptor pass_desc = {};
    pass_desc.label = to_wgpu_string("modelscript-compute-pass");
    WGPUComputePassEncoder pass = wgpuCommandEncoderBeginComputePass(encoder, &pass_desc);
    wgpuComputePassEncoderSetPipeline(pass, pipeline);
    wgpuComputePassEncoderSetBindGroup(pass, 0, bind_group, 0, nullptr);
    wgpuComputePassEncoderDispatchWorkgroups(pass, workgroups_x, 1, 1);
    wgpuComputePassEncoderEnd(pass);
    wgpuComputePassEncoderRelease(pass);

    if (output_bytes > 0) {
      wgpuCommandEncoderCopyBufferToBuffer(encoder, output_buf, 0, readback_buf, 0, output_buf_size);
    }

    WGPUCommandBufferDescriptor cmd_desc = {};
    cmd_buf = wgpuCommandEncoderFinish(encoder, &cmd_desc);
    if (!cmd_buf) {
      rc = -11;
      break;
    }

    wgpuQueueSubmit(queue, 1, &cmd_buf);

    // 6. Map staging buffer and copy results back to host
    if (output_bytes > 0) {
      if (!map_buffer_read_sync(instance, device, readback_buf, output_buf_size)) {
        rc = -12;
        break;
      }
      const void* mapped = wgpuBufferGetConstMappedRange(readback_buf, 0, output_buf_size);
      if (!mapped) {
        wgpuBufferUnmap(readback_buf);
        rc = -13;
        break;
      }
      std::memcpy(output_data, mapped, output_bytes);
      wgpuBufferUnmap(readback_buf);
    }
  } while (false);

  if (cmd_buf) wgpuCommandBufferRelease(cmd_buf);
  if (encoder) wgpuCommandEncoderRelease(encoder);
  if (bind_group) wgpuBindGroupRelease(bind_group);
  if (bgl) wgpuBindGroupLayoutRelease(bgl);
  if (readback_buf) wgpuBufferRelease(readback_buf);
  if (output_buf) wgpuBufferRelease(output_buf);
  if (input_buf) wgpuBufferRelease(input_buf);
  if (pipeline) wgpuComputePipelineRelease(pipeline);
  if (shader) wgpuShaderModuleRelease(shader);
  if (queue) wgpuQueueRelease(queue);
  wgpuDeviceRelease(device);
  wgpuAdapterRelease(adapter);
  wgpuInstanceRelease(instance);
  return rc;
#else
  (void)wgsl_source;
  (void)entry_point;
  (void)input_data;
  (void)input_bytes;
  (void)output_data;
  (void)output_bytes;
  (void)workgroups_x;
  return -1;
#endif
}

}  // extern "C"

