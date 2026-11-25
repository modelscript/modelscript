#include "bms_ekf.h"

double bms_ekf_step(BmsEkf *ekf, double v_meas, double i_load, double dt) {
  double soc_pred = ekf->soc - (i_load * dt) / ekf->q_nom_as;
  if (soc_pred > 1.0) {
    soc_pred = 1.0;
  } else if (soc_pred < 0.0) {
    soc_pred = 0.0;
  }

  double p_pred = ekf->p_cov + ekf->q_noise;
  double ocv = 3.20 + 0.95 * soc_pred;
  double v_pred = ocv - i_load * ekf->r0;
  double h_jac = 0.95;

  double s_cov = h_jac * p_pred * h_jac + ekf->r_noise;
  double k_gain = (p_pred * h_jac) / s_cov;

  ekf->soc = soc_pred + k_gain * (v_meas - v_pred);
  ekf->p_cov = (1.0 - k_gain * h_jac) * p_pred;

  return ekf->soc;
}
