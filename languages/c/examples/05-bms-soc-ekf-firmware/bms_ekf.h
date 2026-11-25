#ifndef BMS_EKF_H
#define BMS_EKF_H

typedef struct {
  double soc;
  double p_cov;
  double q_nom_as;
  double r0;
  double q_noise;
  double r_noise;
} BmsEkf;

double bms_ekf_step(BmsEkf *ekf, double v_meas, double i_load, double dt);

#endif
