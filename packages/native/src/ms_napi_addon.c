// SPDX-License-Identifier: AGPL-3.0-or-later
#include <node_api.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "ms_native_core.h"

extern napi_value ms_create_runtime_napi_exports(napi_env env);
extern napi_value ms_create_simulate_napi_exports(napi_env env);

static char* napi_dup_utf8_string(napi_env env, napi_value val, const char* arg_name) {
  napi_valuetype vt = napi_undefined;
  if (napi_typeof(env, val, &vt) != napi_ok || vt != napi_string) {
    char msg[128];
    snprintf(msg, sizeof(msg), "Expected string for argument '%s'", arg_name);
    napi_throw_type_error(env, "ERR_INVALID_ARG_TYPE", msg);
    return NULL;
  }

  size_t len = 0;
  if (napi_get_value_string_utf8(env, val, NULL, 0, &len) != napi_ok) {
    napi_throw_error(env, "ERR_MS_NAPI", "Failed to measure UTF-8 string length");
    return NULL;
  }

  char* buf = (char*)malloc(len + 1);
  if (!buf) {
    napi_throw_error(env, "ERR_MS_OOM", "Out of memory allocating string buffer");
    return NULL;
  }

  size_t written = 0;
  if (napi_get_value_string_utf8(env, val, buf, len + 1, &written) != napi_ok) {
    free(buf);
    napi_throw_error(env, "ERR_MS_NAPI", "Failed to read UTF-8 string");
    return NULL;
  }
  buf[written] = '\0';
  return buf;
}

static size_t typedarray_element_size(napi_typedarray_type ta_type) {
  switch (ta_type) {
    case napi_int8_array:
    case napi_uint8_array:
    case napi_uint8_clamped_array:
      return 1;
    case napi_int16_array:
    case napi_uint16_array:
      return 2;
    case napi_int32_array:
    case napi_uint32_array:
    case napi_float32_array:
      return 4;
    case napi_float64_array:
    case napi_bigint64_array:
    case napi_biguint64_array:
      return 8;
    default:
      return 0;
  }
}

static bool extract_buffer_bytes(
    napi_env env,
    napi_value val,
    void** out_ptr,
    size_t* out_byte_len) {
  bool is_ab = false;
  if (napi_is_arraybuffer(env, val, &is_ab) == napi_ok && is_ab) {
    return napi_get_arraybuffer_info(env, val, out_ptr, out_byte_len) == napi_ok;
  }

  bool is_ta = false;
  if (napi_is_typedarray(env, val, &is_ta) == napi_ok && is_ta) {
    napi_typedarray_type ta_type = napi_uint8_array;
    size_t ta_len = 0;
    if (napi_get_typedarray_info(env, val, &ta_type, &ta_len, out_ptr, NULL, NULL) != napi_ok) {
      return false;
    }
    const size_t elem_size = typedarray_element_size(ta_type);
    if (elem_size == 0) {
      return false;
    }
    *out_byte_len = ta_len * elem_size;
    return true;
  }

  bool is_dv = false;
  if (napi_is_dataview(env, val, &is_dv) == napi_ok && is_dv) {
    return napi_get_dataview_info(env, val, out_byte_len, out_ptr, NULL, NULL) == napi_ok;
  }

  return false;
}

static bool get_non_negative_u32(
    napi_env env,
    napi_value val,
    const char* arg_name,
    uint32_t* out_val) {
  napi_valuetype vt = napi_undefined;
  double num = 0.0;
  if (napi_typeof(env, val, &vt) != napi_ok || vt != napi_number ||
      napi_get_value_double(env, val, &num) != napi_ok ||
      num < 0.0 || num > 4294967295.0) {
    char msg[128];
    snprintf(msg, sizeof(msg), "Expected non-negative uint32 for argument '%s'", arg_name);
    napi_throw_type_error(env, "ERR_INVALID_ARG_TYPE", msg);
    return false;
  }
  *out_val = (uint32_t)num;
  return true;
}

static bool get_positive_i32(
    napi_env env,
    napi_value val,
    const char* arg_name,
    int32_t* out_val) {
  napi_valuetype vt = napi_undefined;
  int32_t num = 0;
  if (napi_typeof(env, val, &vt) != napi_ok || vt != napi_number ||
      napi_get_value_int32(env, val, &num) != napi_ok || num <= 0) {
    char msg[128];
    snprintf(msg, sizeof(msg), "Expected positive int32 for argument '%s'", arg_name);
    napi_throw_type_error(env, "ERR_INVALID_ARG_TYPE", msg);
    return false;
  }
  *out_val = num;
  return true;
}

static napi_value napi_selftest(napi_env env, napi_callback_info info) {
  (void)info;
  int rc = ms_native_selftest();
  napi_value out;
  napi_create_int32(env, rc, &out);
  return out;
}

static napi_value napi_gpu_capabilities(napi_env env, napi_callback_info info) {
  (void)info;
  ms_gpu_capabilities_t caps;
  memset(&caps, 0, sizeof(caps));
  ms_gpu_dawn_probe(&caps);
  ms_gpu_cuda_hip_probe(&caps);

  napi_value obj;
  napi_create_object(env, &obj);

  napi_value v;
  napi_get_boolean(env, caps.dawn_compiled, &v);
  napi_set_named_property(env, obj, "dawnCompiled", v);
  napi_get_boolean(env, caps.dawn_available, &v);
  napi_set_named_property(env, obj, "dawnAvailable", v);
  napi_get_boolean(env, caps.cuda_compiled, &v);
  napi_set_named_property(env, obj, "cudaCompiled", v);
  napi_get_boolean(env, caps.cuda_available, &v);
  napi_set_named_property(env, obj, "cudaAvailable", v);
  napi_get_boolean(env, caps.hip_compiled, &v);
  napi_set_named_property(env, obj, "hipCompiled", v);
  napi_get_boolean(env, caps.hip_available, &v);
  napi_set_named_property(env, obj, "hipAvailable", v);
  napi_get_boolean(env, caps.hardware_fp64, &v);
  napi_set_named_property(env, obj, "hardwareFp64", v);
  napi_get_boolean(env, ms_sundials_native_available() != 0, &v);
  napi_set_named_property(env, obj, "sundialsCompiled", v);

  napi_create_string_utf8(env, caps.backend_name[0] ? caps.backend_name : "cpu-wasm2c", NAPI_AUTO_LENGTH, &v);
  napi_set_named_property(env, obj, "backendName", v);
  napi_create_string_utf8(env, caps.adapter_name, NAPI_AUTO_LENGTH, &v);
  napi_set_named_property(env, obj, "adapterName", v);
  return obj;
}

static napi_value napi_dispatch_dawn_compute(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value argv[5];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 5) {
    napi_throw_type_error(
        env,
        "ERR_INVALID_ARG_COUNT",
        "dispatchDawnCompute(wgslSource, entryPoint, inputBuf, outputBytes, workgroupsX) requires 5 arguments");
    return NULL;
  }

  char* wgsl_source = napi_dup_utf8_string(env, argv[0], "wgslSource");
  if (!wgsl_source) return NULL;

  char* entry_point = napi_dup_utf8_string(env, argv[1], "entryPoint");
  if (!entry_point) {
    free(wgsl_source);
    return NULL;
  }

  void* input_ptr = NULL;
  size_t input_bytes = 0;
  if (!extract_buffer_bytes(env, argv[2], &input_ptr, &input_bytes)) {
    free(wgsl_source);
    free(entry_point);
    napi_throw_type_error(
        env,
        "ERR_INVALID_ARG_TYPE",
        "Expected ArrayBuffer or ArrayBufferView for argument 'inputBuf'");
    return NULL;
  }

  uint32_t output_bytes_u32 = 0;
  uint32_t workgroups_x = 0;
  if (!get_non_negative_u32(env, argv[3], "outputBytes", &output_bytes_u32) ||
      !get_non_negative_u32(env, argv[4], "workgroupsX", &workgroups_x)) {
    free(wgsl_source);
    free(entry_point);
    return NULL;
  }

  const size_t output_bytes = (size_t)output_bytes_u32;
  void* out_data = NULL;
  napi_value out_ab = NULL;
  napi_value out_u8 = NULL;
  if (napi_create_arraybuffer(env, output_bytes, &out_data, &out_ab) != napi_ok ||
      napi_create_typedarray(env, napi_uint8_array, output_bytes, out_ab, 0, &out_u8) != napi_ok) {
    free(wgsl_source);
    free(entry_point);
    napi_throw_error(env, "ERR_MS_OOM", "Failed to allocate output Uint8Array");
    return NULL;
  }

  const int rc = ms_gpu_dawn_dispatch_compute(
      wgsl_source,
      entry_point,
      input_ptr,
      input_bytes,
      out_data,
      output_bytes,
      workgroups_x);
  free(wgsl_source);
  free(entry_point);

  if (rc == 0) {
    return out_u8;
  }

#ifdef MS_ENABLE_DAWN
  if (rc == -2 || rc == -3) {
    napi_value null_val;
    napi_get_null(env, &null_val);
    return null_val;
  }
  char msg[128];
  snprintf(msg, sizeof(msg), "ms_gpu_dawn_dispatch_compute failed (rc=%d)", rc);
  napi_throw_error(env, "ERR_MS_DAWN_COMPUTE", msg);
  return NULL;
#else
  napi_value null_val;
  napi_get_null(env, &null_val);
  return null_val;
#endif
}

static napi_value napi_execute_fp64_batch(napi_env env, napi_callback_info info) {
  size_t argc = 7;
  napi_value argv[7];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 7) {
    napi_throw_type_error(
        env,
        "ERR_INVALID_ARG_COUNT",
        "executeFp64Batch(sourceCode, kernelName, states, nVars, nEqs, batchSize, simTime) requires 7 arguments");
    return NULL;
  }

  char* source_code = napi_dup_utf8_string(env, argv[0], "sourceCode");
  if (!source_code) return NULL;

  char* kernel_name = napi_dup_utf8_string(env, argv[1], "kernelName");
  if (!kernel_name) {
    free(source_code);
    return NULL;
  }

  bool is_ta = false;
  napi_typedarray_type ta_type = napi_uint8_array;
  size_t states_len = 0;
  void* states_ptr = NULL;
  if (napi_is_typedarray(env, argv[2], &is_ta) != napi_ok || !is_ta ||
      napi_get_typedarray_info(env, argv[2], &ta_type, &states_len, &states_ptr, NULL, NULL) != napi_ok ||
      ta_type != napi_float64_array) {
    free(source_code);
    free(kernel_name);
    napi_throw_type_error(env, "ERR_INVALID_ARG_TYPE", "Expected Float64Array for argument 'states'");
    return NULL;
  }

  int32_t n_vars = 0;
  int32_t n_eqs = 0;
  int32_t batch_size = 0;
  if (!get_positive_i32(env, argv[3], "nVars", &n_vars) ||
      !get_positive_i32(env, argv[4], "nEqs", &n_eqs) ||
      !get_positive_i32(env, argv[5], "batchSize", &batch_size)) {
    free(source_code);
    free(kernel_name);
    return NULL;
  }

  napi_valuetype sim_time_vt = napi_undefined;
  double sim_time = 0.0;
  if (napi_typeof(env, argv[6], &sim_time_vt) != napi_ok || sim_time_vt != napi_number ||
      napi_get_value_double(env, argv[6], &sim_time) != napi_ok) {
    free(source_code);
    free(kernel_name);
    napi_throw_type_error(env, "ERR_INVALID_ARG_TYPE", "Expected number for argument 'simTime'");
    return NULL;
  }

  const size_t required_states = (size_t)batch_size * (size_t)n_vars;
  if (states_len < required_states) {
    free(source_code);
    free(kernel_name);
    napi_throw_range_error(
        env,
        "ERR_OUT_OF_RANGE",
        "states Float64Array length is smaller than batchSize * nVars");
    return NULL;
  }

  ms_gpu_capabilities_t caps;
  memset(&caps, 0, sizeof(caps));
  ms_gpu_cuda_hip_probe(&caps);
  if (!caps.cuda_available && !caps.hip_available) {
    free(source_code);
    free(kernel_name);
    napi_value null_val;
    napi_get_null(env, &null_val);
    return null_val;
  }

  const size_t out_count = (size_t)batch_size * (size_t)n_eqs;
  const size_t out_bytes = out_count * sizeof(double);
  void* out_data = NULL;
  napi_value out_ab = NULL;
  napi_value out_f64 = NULL;
  if (napi_create_arraybuffer(env, out_bytes, &out_data, &out_ab) != napi_ok ||
      napi_create_typedarray(env, napi_float64_array, out_count, out_ab, 0, &out_f64) != napi_ok) {
    free(source_code);
    free(kernel_name);
    napi_throw_error(env, "ERR_MS_OOM", "Failed to allocate output Float64Array");
    return NULL;
  }

  char error_buf[2048];
  error_buf[0] = '\0';
  const int rc = ms_gpu_fp64_execute_batch(
      source_code,
      kernel_name,
      (const double*)states_ptr,
      (double*)out_data,
      (int)n_vars,
      (int)n_eqs,
      (int)batch_size,
      sim_time,
      error_buf,
      sizeof(error_buf));
  free(source_code);
  free(kernel_name);

  if (rc != 0) {
    char fallback_msg[128];
    if (error_buf[0] == '\0') {
      snprintf(fallback_msg, sizeof(fallback_msg), "ms_gpu_fp64_execute_batch failed (rc=%d)", rc);
    }
    napi_throw_error(env, "ERR_MS_GPU_FP64", error_buf[0] ? error_buf : fallback_msg);
    return NULL;
  }

  return out_f64;
}

static napi_value Init(napi_env env, napi_value exports) {
  ms_native_init();

  napi_set_named_property(env, exports, "runtime", ms_create_runtime_napi_exports(env));
  napi_set_named_property(env, exports, "simulate", ms_create_simulate_napi_exports(env));

  napi_value fn_selftest;
  napi_create_function(env, "selftest", NAPI_AUTO_LENGTH, napi_selftest, NULL, &fn_selftest);
  napi_set_named_property(env, exports, "selftest", fn_selftest);

  napi_value fn_gpu_caps;
  napi_create_function(env, "getGpuCapabilities", NAPI_AUTO_LENGTH, napi_gpu_capabilities, NULL, &fn_gpu_caps);
  napi_set_named_property(env, exports, "getGpuCapabilities", fn_gpu_caps);

  napi_value fn_dispatch_dawn;
  napi_create_function(env, "dispatchDawnCompute", NAPI_AUTO_LENGTH, napi_dispatch_dawn_compute, NULL, &fn_dispatch_dawn);
  napi_set_named_property(env, exports, "dispatchDawnCompute", fn_dispatch_dawn);

  napi_value fn_exec_fp64;
  napi_create_function(env, "executeFp64Batch", NAPI_AUTO_LENGTH, napi_execute_fp64_batch, NULL, &fn_exec_fp64);
  napi_set_named_property(env, exports, "executeFp64Batch", fn_exec_fp64);

  napi_value sundials_avail;
  napi_get_boolean(env, ms_sundials_native_available() != 0, &sundials_avail);
  napi_set_named_property(env, exports, "sundialsAvailable", sundials_avail);

  napi_value backend_str;
  napi_create_string_utf8(env, "wasm2c-native", NAPI_AUTO_LENGTH, &backend_str);
  napi_set_named_property(env, exports, "backend", backend_str);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
