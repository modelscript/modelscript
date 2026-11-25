#include "bms_ekf.h"
#include "safety_limits.h"

int run_bms_cycle(BmsEkf *ekf, double v_cell, double i_pack, double temp_c, double dt) {
  int fault_code = check_cell_safety(v_cell, i_pack, temp_c);
  if (fault_code != BMS_OK) {
    return fault_code;
  }

  double soc_est = bms_ekf_step(ekf, v_cell, i_pack, dt);
  if (soc_est < BMS_SOC_MIN) {
    return BMS_FAULT_UNDERVOLT;
  }
  return BMS_OK;
}
