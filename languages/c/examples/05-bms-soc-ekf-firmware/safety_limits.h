#ifndef SAFETY_LIMITS_H
#define SAFETY_LIMITS_H

#define BMS_OK              0
#define BMS_FAULT_OVERVOLT  1
#define BMS_FAULT_UNDERVOLT 2
#define BMS_FAULT_OVERTEMP  3
#define BMS_SOC_MIN         0.05

static inline int check_cell_safety(double v_cell, double i_pack, double temp_c) {
  double abs_i = (i_pack < 0.0) ? -i_pack : i_pack;
  if (v_cell > 4.22) {
    return BMS_FAULT_OVERVOLT;
  }
  if (v_cell < 2.80) {
    return BMS_FAULT_UNDERVOLT;
  }
  if (temp_c > 55.0 || abs_i > 250.0) {
    return BMS_FAULT_OVERTEMP;
  }
  return BMS_OK;
}

#endif
