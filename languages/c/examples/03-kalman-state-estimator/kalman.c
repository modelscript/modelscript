#include "kalman.h"

void kalman_init(Kalman1D *kf, double pos0, double vel0, double q_proc, double r_meas) {
  kf->pos = pos0;
  kf->vel = vel0;
  kf->p00 = 1.0;
  kf->p01 = 0.0;
  kf->p10 = 0.0;
  kf->p11 = 1.0;
  kf->q_proc = q_proc;
  kf->r_meas = r_meas;
}

double kalman_update(Kalman1D *kf, double z_pos, double dt) {
  double pred_pos = kf->pos + kf->vel * dt;
  double pred_vel = kf->vel;

  double p00 = kf->p00 + dt * (kf->p10 + kf->p01) + dt * dt * kf->p11 + kf->q_proc;
  double p01 = kf->p01 + dt * kf->p11;
  double p10 = kf->p10 + dt * kf->p11;
  double p11 = kf->p11 + kf->q_proc;

  double innovation = z_pos - pred_pos;
  double s_cov = p00 + kf->r_meas;
  double k0 = p00 / s_cov;
  double k1 = p10 / s_cov;

  kf->pos = pred_pos + k0 * innovation;
  kf->vel = pred_vel + k1 * innovation;
  kf->p00 = (1.0 - k0) * p00;
  kf->p01 = (1.0 - k0) * p01;
  kf->p10 = p10 - k1 * p00;
  kf->p11 = p11 - k1 * p01;

  return kf->pos;
}
