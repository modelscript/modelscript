// SPDX-License-Identifier: AGPL-3.0-or-later
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "ms_native_core.h"

#ifndef MS_VERSION
#define MS_VERSION "0.1.0"
#endif

namespace {

ms_gpu_capabilities_t probe_gpu_capabilities() {
  ms_gpu_capabilities_t caps;
  std::memset(&caps, 0, sizeof(caps));
  ms_gpu_dawn_probe(&caps);
  ms_gpu_cuda_hip_probe(&caps);
  return caps;
}

std::string json_escape(const char* input) {
  if (!input) return "";
  std::string out;
  for (const unsigned char* p = reinterpret_cast<const unsigned char*>(input); *p; ++p) {
    const unsigned char c = *p;
    switch (c) {
      case '\"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
        break;
      case '\b':
        out += "\\b";
        break;
      case '\f':
        out += "\\f";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned int>(c));
          out += buf;
        } else {
          out.push_back(static_cast<char>(c));
        }
        break;
    }
  }
  return out;
}

bool find_json_value_start(const std::string& json, const std::string& key, size_t& out_pos) {
  const std::string needle = "\"" + key + "\"";
  size_t search_from = 0;
  while (search_from < json.size()) {
    const size_t pos = json.find(needle, search_from);
    if (pos == std::string::npos) return false;
    size_t i = pos + needle.size();
    while (i < json.size() && std::isspace(static_cast<unsigned char>(json[i]))) ++i;
    if (i < json.size() && json[i] == ':') {
      ++i;
      while (i < json.size() && std::isspace(static_cast<unsigned char>(json[i]))) ++i;
      out_pos = i;
      return true;
    }
    search_from = pos + needle.size();
  }
  return false;
}

bool json_extract_string(const std::string& json, const std::string& key, std::string& out_val) {
  size_t pos = 0;
  if (!find_json_value_start(json, key, pos)) return false;
  if (pos >= json.size() || json[pos] != '\"') return false;
  ++pos;
  std::string result;
  while (pos < json.size()) {
    const char c = json[pos++];
    if (c == '\\' && pos < json.size()) {
      const char esc = json[pos++];
      switch (esc) {
        case '\"':
          result.push_back('\"');
          break;
        case '\\':
          result.push_back('\\');
          break;
        case '/':
          result.push_back('/');
          break;
        case 'n':
          result.push_back('\n');
          break;
        case 'r':
          result.push_back('\r');
          break;
        case 't':
          result.push_back('\t');
          break;
        default:
          result.push_back(esc);
          break;
      }
    } else if (c == '\"') {
      out_val = result;
      return true;
    } else {
      result.push_back(c);
    }
  }
  return false;
}

bool json_extract_double(const std::string& json, const std::string& key, double& out_val) {
  size_t pos = 0;
  if (!find_json_value_start(json, key, pos)) return false;
  if (pos >= json.size()) return false;
  const char* start = json.c_str() + pos;
  char* end = nullptr;
  const double parsed = std::strtod(start, &end);
  if (end == start) return false;
  out_val = parsed;
  return true;
}

bool json_extract_u32(const std::string& json, const std::string& key, uint32_t& out_val) {
  double d = 0.0;
  if (!json_extract_double(json, key, d)) return false;
  if (d < 0.0 || d > 4294967295.0) return false;
  out_val = static_cast<uint32_t>(d);
  return true;
}

bool write_output(const std::string& content, const char* out_path) {
  if (out_path && out_path[0] != '\0') {
    std::ofstream ofs(out_path, std::ios::binary | std::ios::trunc);
    if (!ofs) {
      std::fprintf(stderr, "msx-hpc-worker: failed to open output file '%s'\n", out_path);
      return false;
    }
    ofs.write(content.data(), static_cast<std::streamsize>(content.size()));
    if (!ofs.good()) {
      std::fprintf(stderr, "msx-hpc-worker: failed to write output file '%s'\n", out_path);
      return false;
    }
    return true;
  }
  std::fwrite(content.data(), 1, content.size(), stdout);
  return true;
}

void print_info_json() {
  const ms_gpu_capabilities_t caps = probe_gpu_capabilities();
  const std::string gpu_backend =
      json_escape(caps.backend_name[0] ? caps.backend_name : "cpu-wasm2c");
  const std::string gpu_adapter = json_escape(caps.adapter_name);

  std::printf(
      "{\n"
      "  \"worker\": \"msx-hpc-worker\",\n"
      "  \"version\": \"%s\",\n"
      "  \"cpuBackend\": \"wasm2c-native\",\n"
      "  \"dawnCompiled\": %s,\n"
      "  \"dawnAvailable\": %s,\n"
      "  \"cudaCompiled\": %s,\n"
      "  \"cudaAvailable\": %s,\n"
      "  \"hipCompiled\": %s,\n"
      "  \"hipAvailable\": %s,\n"
      "  \"hardwareFp64\": %s,\n"
      "  \"gpuBackend\": \"%s\",\n"
      "  \"gpuAdapter\": \"%s\"\n"
      "}\n",
      MS_VERSION,
      caps.dawn_compiled ? "true" : "false",
      caps.dawn_available ? "true" : "false",
      caps.cuda_compiled ? "true" : "false",
      caps.cuda_available ? "true" : "false",
      caps.hip_compiled ? "true" : "false",
      caps.hip_available ? "true" : "false",
      caps.hardware_fp64 ? "true" : "false",
      gpu_backend.c_str(),
      gpu_adapter.c_str());
}

std::string format_job_result_json(
    const char* status,
    const std::string& task,
    uint64_t num_nodes,
    uint64_t num_tets,
    int64_t elapsed_us,
    const ms_gpu_capabilities_t& caps) {
  const std::string escaped_task = json_escape(task.c_str());
  const std::string gpu_backend =
      json_escape(caps.backend_name[0] ? caps.backend_name : "cpu-wasm2c");

  std::ostringstream oss;
  oss << "{\n"
      << "  \"status\": \"" << status << "\",\n"
      << "  \"task\": \"" << escaped_task << "\",\n"
      << "  \"backend\": \"wasm2c-native\",\n"
      << "  \"numNodes\": " << num_nodes << ",\n"
      << "  \"numTets\": " << num_tets << ",\n"
      << "  \"elapsedUs\": " << elapsed_us << ",\n"
      << "  \"gpuBackend\": \"" << gpu_backend << "\",\n"
      << "  \"hardwareFp64\": " << (caps.hardware_fp64 ? "true" : "false") << "\n"
      << "}\n";
  return oss.str();
}

std::string format_json_double(double val) {
  if (!std::isfinite(val)) return "null";
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.17g", val);
  return std::string(buf);
}

struct SimSample {
  double t;
  std::vector<double> y;
};

std::string format_simulate_dae_result_json(
    const char* status,
    const std::string& model,
    uint64_t steps,
    double final_time,
    const std::vector<double>& final_state,
    const std::vector<SimSample>& samples,
    int64_t elapsed_us,
    const ms_gpu_capabilities_t& caps) {
  const std::string escaped_model = json_escape(model.c_str());
  const std::string gpu_backend =
      json_escape(caps.backend_name[0] ? caps.backend_name : "cpu-wasm2c");

  std::ostringstream oss;
  oss << "{\n"
      << "  \"status\": \"" << status << "\",\n"
      << "  \"task\": \"simulate_dae\",\n"
      << "  \"model\": \"" << escaped_model << "\",\n"
      << "  \"backend\": \"cpu-fp64-rk4\",\n"
      << "  \"steps\": " << steps << ",\n"
      << "  \"finalTime\": " << format_json_double(final_time) << ",\n"
      << "  \"finalState\": [";
  for (size_t i = 0; i < final_state.size(); ++i) {
    if (i > 0) oss << ", ";
    oss << format_json_double(final_state[i]);
  }
  oss << "],\n"
      << "  \"samples\": [\n";
  for (size_t i = 0; i < samples.size(); ++i) {
    oss << "    {\"t\": " << format_json_double(samples[i].t) << ", \"y\": [";
    for (size_t j = 0; j < samples[i].y.size(); ++j) {
      if (j > 0) oss << ", ";
      oss << format_json_double(samples[i].y[j]);
    }
    oss << "]}";
    if (i + 1 < samples.size()) oss << ",";
    oss << "\n";
  }
  oss << "  ],\n"
      << "  \"elapsedUs\": " << elapsed_us << ",\n"
      << "  \"gpuBackend\": \"" << gpu_backend << "\",\n"
      << "  \"hardwareFp64\": " << (caps.hardware_fp64 ? "true" : "false") << "\n"
      << "}\n";
  return oss.str();
}

int run_job_file(const char* job_path, const char* out_path) {
  std::ifstream ifs(job_path, std::ios::binary);
  if (!ifs) {
    std::fprintf(stderr, "msx-hpc-worker: failed to open job file '%s'\n", job_path);
    return 1;
  }
  std::ostringstream buffer;
  buffer << ifs.rdbuf();
  const std::string json = buffer.str();

  std::string task;
  if (!json_extract_string(json, "task", task) || task.empty()) {
    std::fprintf(stderr, "msx-hpc-worker: job file '%s' missing string field \"task\"\n", job_path);
    return 1;
  }

  const ms_gpu_capabilities_t caps = probe_gpu_capabilities();

  if (task == "mesh_box") {
    uint32_t nx = 2;
    uint32_t ny = 2;
    uint32_t nz = 2;
    double x0 = 0.0;
    double y0 = 0.0;
    double z0 = 0.0;
    double dx = 1.0;
    double dy = 1.0;
    double dz = 1.0;

    (void)json_extract_u32(json, "nx", nx);
    (void)json_extract_u32(json, "ny", ny);
    (void)json_extract_u32(json, "nz", nz);
    (void)json_extract_double(json, "x0", x0);
    (void)json_extract_double(json, "y0", y0);
    (void)json_extract_double(json, "z0", z0);
    (void)json_extract_double(json, "dx", dx);
    (void)json_extract_double(json, "dy", dy);
    (void)json_extract_double(json, "dz", dz);

    if (nx == 0 || ny == 0 || nz == 0) {
      std::fprintf(stderr, "msx-hpc-worker: mesh_box requires nx, ny, nz >= 1\n");
      return 2;
    }

    const uint64_t num_nodes =
        static_cast<uint64_t>(nx + 1U) *
        static_cast<uint64_t>(ny + 1U) *
        static_cast<uint64_t>(nz + 1U);
    const uint64_t num_cells =
        static_cast<uint64_t>(nx) *
        static_cast<uint64_t>(ny) *
        static_cast<uint64_t>(nz);
    const uint64_t coord_bytes = num_nodes * 3ULL * sizeof(double);
    const uint64_t elem_bytes = num_cells * 6ULL * 4ULL * sizeof(uint32_t);
    if (coord_bytes > 0x7FFFFFFFULL || elem_bytes > 0x7FFFFFFFULL) {
      std::fprintf(stderr, "msx-hpc-worker: mesh_box dimensions exceed wasm32 linear memory limit\n");
      return 2;
    }

    ms_native_init();
    w2c_ms__simulate* sim = ms_get_simulate_instance();

    const auto t0 = std::chrono::steady_clock::now();
    const u32 coords_ptr = w2c_ms__simulate_alloc(sim, static_cast<u32>(coord_bytes));
    const u32 elems_ptr = w2c_ms__simulate_alloc(sim, static_cast<u32>(elem_bytes));
    if (coords_ptr == 0 || elems_ptr == 0) {
      if (coords_ptr != 0) w2c_ms__simulate_free(sim, coords_ptr);
      if (elems_ptr != 0) w2c_ms__simulate_free(sim, elems_ptr);
      std::fprintf(stderr, "msx-hpc-worker: simulate linear memory allocation failed\n");
      return 3;
    }

    w2c_ms__simulate_mesh_createBoxCoords(
        sim, nx, ny, nz, x0, y0, z0, dx, dy, dz, coords_ptr);
    const u32 num_tets = w2c_ms__simulate_mesh_createBoxTets(sim, nx, ny, nz, elems_ptr);

    w2c_ms__simulate_free(sim, elems_ptr);
    w2c_ms__simulate_free(sim, coords_ptr);
    const auto t1 = std::chrono::steady_clock::now();

    const int64_t elapsed_us =
        std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count();
    const std::string result = format_job_result_json(
        "ok", task, num_nodes, static_cast<uint64_t>(num_tets), elapsed_us, caps);
    return write_output(result, out_path) ? 0 : 1;
  }

  if (task == "selftest") {
    const auto t0 = std::chrono::steady_clock::now();
    const int rc = ms_native_selftest();
    const auto t1 = std::chrono::steady_clock::now();
    const int64_t elapsed_us =
        std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count();
    const std::string result = format_job_result_json(
        rc == 0 ? "ok" : "error",
        task,
        0ULL,
        rc == 0 ? 48ULL : 0ULL,
        elapsed_us,
        caps);
    if (!write_output(result, out_path)) return 1;
    return rc;
  }

  if (task == "gpu_probe") {
    const auto t0 = std::chrono::steady_clock::now();
    const ms_gpu_capabilities_t fresh_caps = probe_gpu_capabilities();
    const auto t1 = std::chrono::steady_clock::now();
    const int64_t elapsed_us =
        std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count();
    const std::string result = format_job_result_json(
        "ok", task, 0ULL, 0ULL, elapsed_us, fresh_caps);
    return write_output(result, out_path) ? 0 : 1;
  }

  if (task == "simulate_dae") {
    std::string model = "decay";
    double t0 = 0.0;
    double t_end = 1.0;
    double dt = 0.001;
    double decay_rate = 1.0;
    double omega = 1.0;
    double y0 = 1.0;
    double v0 = 0.0;
    uint32_t sample_interval = 100U;

    (void)json_extract_string(json, "model", model);
    (void)json_extract_double(json, "t0", t0);
    (void)json_extract_double(json, "tEnd", t_end);
    (void)json_extract_double(json, "dt", dt);
    (void)json_extract_double(json, "decayRate", decay_rate);
    (void)json_extract_double(json, "omega", omega);
    (void)json_extract_double(json, "y0", y0);
    (void)json_extract_double(json, "v0", v0);
    (void)json_extract_u32(json, "sampleInterval", sample_interval);

    const bool is_harmonic = (model == "harmonic");
    const bool is_decay = (model == "decay" || model == "exponential_decay");
    if (!is_harmonic && !is_decay) {
      std::fprintf(stderr, "msx-hpc-worker: unsupported simulate_dae model '%s'\n", model.c_str());
      return 2;
    }
    if (!std::isfinite(t0) || !std::isfinite(t_end) || !std::isfinite(dt) ||
        dt <= 0.0 || t_end < t0) {
      std::fprintf(
          stderr,
          "msx-hpc-worker: simulate_dae requires finite t0 <= tEnd and dt > 0\n");
      return 2;
    }
    if (!std::isfinite(y0) || !std::isfinite(v0) ||
        !std::isfinite(decay_rate) || !std::isfinite(omega)) {
      std::fprintf(stderr, "msx-hpc-worker: simulate_dae parameters must be finite\n");
      return 2;
    }
    if (sample_interval == 0U) {
      sample_interval = 1U;
    }

    const double span = t_end - t0;
    uint64_t steps = 0ULL;
    if (span > 0.0) {
      const double raw_steps = span / dt;
      const double rounded = std::round(raw_steps);
      if (std::fabs(raw_steps - rounded) < 1e-9 && rounded >= 1.0) {
        steps = static_cast<uint64_t>(rounded);
      } else {
        steps = static_cast<uint64_t>(std::ceil(raw_steps));
      }
    }

    std::vector<SimSample> samples;
    samples.reserve(static_cast<size_t>(steps / static_cast<uint64_t>(sample_interval)) + 2U);

    const auto wall_start = std::chrono::steady_clock::now();

    double t = t0;
    std::vector<double> final_state;

    if (is_harmonic) {
      double x = y0;
      double v = v0;
      const double w2 = omega * omega;

      samples.push_back(SimSample{t, {x, v}});

      for (uint64_t step = 0ULL; step < steps; ++step) {
        const double t_next =
            (step + 1ULL == steps) ? t_end : (t0 + static_cast<double>(step + 1ULL) * dt);
        const double h = t_next - t;

        const double k1_x = v;
        const double k1_v = -w2 * x;

        const double k2_x = v + 0.5 * h * k1_v;
        const double k2_v = -w2 * (x + 0.5 * h * k1_x);

        const double k3_x = v + 0.5 * h * k2_v;
        const double k3_v = -w2 * (x + 0.5 * h * k2_x);

        const double k4_x = v + h * k3_v;
        const double k4_v = -w2 * (x + h * k3_x);

        x += (h / 6.0) * (k1_x + 2.0 * k2_x + 2.0 * k3_x + k4_x);
        v += (h / 6.0) * (k1_v + 2.0 * k2_v + 2.0 * k3_v + k4_v);
        t = t_next;

        const uint64_t next_step = step + 1ULL;
        if ((next_step % static_cast<uint64_t>(sample_interval)) == 0ULL || next_step == steps) {
          samples.push_back(SimSample{t, {x, v}});
        }
      }

      final_state = {x, v};
    } else {
      double y = y0;

      samples.push_back(SimSample{t, {y}});

      for (uint64_t step = 0ULL; step < steps; ++step) {
        const double t_next =
            (step + 1ULL == steps) ? t_end : (t0 + static_cast<double>(step + 1ULL) * dt);
        const double h = t_next - t;

        const double k1 = -decay_rate * y;
        const double k2 = -decay_rate * (y + 0.5 * h * k1);
        const double k3 = -decay_rate * (y + 0.5 * h * k2);
        const double k4 = -decay_rate * (y + h * k3);

        y += (h / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
        t = t_next;

        const uint64_t next_step = step + 1ULL;
        if ((next_step % static_cast<uint64_t>(sample_interval)) == 0ULL || next_step == steps) {
          samples.push_back(SimSample{t, {y}});
        }
      }

      final_state = {y};
    }

    const auto wall_end = std::chrono::steady_clock::now();
    const int64_t elapsed_us =
        std::chrono::duration_cast<std::chrono::microseconds>(wall_end - wall_start).count();

    const std::string result = format_simulate_dae_result_json(
        "ok", model, steps, t, final_state, samples, elapsed_us, caps);
    return write_output(result, out_path) ? 0 : 1;
  }

  std::fprintf(stderr, "msx-hpc-worker: unsupported task '%s'\n", task.c_str());
  const std::string err_result =
      format_job_result_json("error", task, 0ULL, 0ULL, 0LL, caps);
  (void)write_output(err_result, out_path);
  return 2;
}

}  // namespace

int main(int argc, char** argv) {
  bool run_selftest = false;
  bool show_version = false;
  bool show_info = false;
  const char* run_job_path = nullptr;
  const char* out_path = nullptr;

  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--version") == 0 || std::strcmp(argv[i], "-v") == 0) {
      show_version = true;
    } else if (std::strcmp(argv[i], "--selftest") == 0) {
      run_selftest = true;
    } else if (std::strcmp(argv[i], "--info") == 0 || std::strcmp(argv[i], "--gpu-info") == 0) {
      show_info = true;
    } else if (std::strcmp(argv[i], "--run") == 0) {
      if (i + 1 >= argc) {
        std::fprintf(stderr, "msx-hpc-worker: --run requires a <job.json> path argument\n");
        return 1;
      }
      run_job_path = argv[++i];
    } else if (std::strcmp(argv[i], "--out") == 0) {
      if (i + 1 >= argc) {
        std::fprintf(stderr, "msx-hpc-worker: --out requires a <result.json> path argument\n");
        return 1;
      }
      out_path = argv[++i];
    }
  }

  if (show_version) {
    std::printf("msx-hpc-worker %s (wasm2c-native)\n", MS_VERSION);
  }
  if (show_info || (!show_version && !run_selftest && run_job_path == nullptr)) {
    print_info_json();
  }
  if (run_selftest) {
    const int rc = ms_native_selftest();
    if (rc != 0) {
      std::fprintf(stderr, "msx-hpc-worker selftest FAILED (rc=%d)\n", rc);
      ms_native_shutdown();
      return rc;
    }
    std::printf("msx-hpc-worker selftest PASSED\n");
  }
  if (run_job_path != nullptr) {
    const int rc = run_job_file(run_job_path, out_path);
    ms_native_shutdown();
    return rc;
  }

  ms_native_shutdown();
  return 0;
}
