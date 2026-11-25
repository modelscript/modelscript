#ifndef KALMAN_H
#define KALMAN_H

typedef struct {
  double pos;
  double vel;
  double p00;
  double p01;
  double p10;
  double p11;
  double q_proc;
  double r_meas;
} Kalman1D;

void kalman_init(Kalman1D *kf, double pos0, double vel0, double q_proc, double r_meas);
double kalman_update(Kalman1D *kf, double z_pos, double dt);

#endif
