// SPDX-License-Identifier: AGPL-3.0-or-later
#include "ms_native_core.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct w2c_env {
  int unused;
};

static bool g_initialized = false;
static struct w2c_env g_env_inst = {0};
static w2c_ms__runtime g_runtime_inst;
static w2c_ms__simulate g_simulate_inst;

/* Host import required by AssemblyScript wasm2c output: env.abort */
void w2c_env_abort(struct w2c_env* env, u32 msg, u32 file, u32 line, u32 col) {
  (void)env;
  fprintf(stderr, "[modelscript-native] AssemblyScript abort(msg=%u, file=%u, line=%u, col=%u)\n",
          msg, file, line, col);
}

void ms_native_init(void) {
  if (g_initialized) return;
  wasm_rt_init();
  wasm2c_ms__runtime_instantiate(&g_runtime_inst, &g_env_inst);
  wasm2c_ms__simulate_instantiate(&g_simulate_inst, &g_env_inst);
  g_initialized = true;
}

void ms_native_shutdown(void) {
  if (!g_initialized) return;
  wasm2c_ms__simulate_free(&g_simulate_inst);
  wasm2c_ms__runtime_free(&g_runtime_inst);
  wasm_rt_free();
  g_initialized = false;
}

w2c_ms__runtime* ms_get_runtime_instance(void) {
  if (!g_initialized) ms_native_init();
  return &g_runtime_inst;
}

w2c_ms__simulate* ms_get_simulate_instance(void) {
  if (!g_initialized) ms_native_init();
  return &g_simulate_inst;
}

int ms_native_selftest(void) {
  ms_native_init();

  // Exercise simulate.wasm2c: allocate and generate a 2x2x2 box tetrahedral mesh (6 Kuhn tets/hex = 48)
  u32 elems_ptr = w2c_ms__simulate_alloc(&g_simulate_inst, 2 * 2 * 2 * 6 * 4 * sizeof(uint32_t));
  if (elems_ptr == 0) {
    fprintf(stderr, "[selftest] simulate alloc failed\n");
    return 1;
  }
  u32 n_tets = w2c_ms__simulate_mesh_createBoxTets(&g_simulate_inst, 2, 2, 2, elems_ptr);
  w2c_ms__simulate_free(&g_simulate_inst, elems_ptr);
  if (n_tets != 48) {
    fprintf(stderr, "[selftest] expected 48 tets for 2x2x2 box, got %u\n", n_tets);
    return 2;
  }

  // Exercise runtime.wasm2c: verify linear memory is initialized and non-zero
  wasm_rt_memory_t* rt_mem = w2c_ms__runtime_memory(&g_runtime_inst);
  if (!rt_mem || !rt_mem->data || rt_mem->size == 0) {
    fprintf(stderr, "[selftest] runtime memory not initialized\n");
    return 3;
  }

  return 0;
}
