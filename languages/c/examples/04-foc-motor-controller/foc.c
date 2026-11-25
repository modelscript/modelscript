#include "foc.h"
#include "math_lut.h"

void foc_step(FocState *st, double ia, double ib, double sin_th, double cos_th, double iq_ref, double dt) {
  double i_alpha = ia;
  double i_beta = INV_SQRT3 * (ia + 2.0 * ib);

  double id = i_alpha * cos_th + i_beta * sin_th;
  double iq = -i_alpha * sin_th + i_beta * cos_th;

  double err_d = 0.0 - id;
  double err_q = iq_ref - iq;

  st->int_d = st->int_d + err_d * dt;
  st->int_q = st->int_q + err_q * dt;

  double vd = st->kp * err_d + st->ki * st->int_d;
  double vq = st->kp * err_q + st->ki * st->int_q;

  double v_alpha = vd * cos_th - vq * sin_th;
  double v_beta = vd * sin_th + vq * cos_th;

  double va = v_alpha;
  double vb = -0.5 * v_alpha + HALF_SQRT3 * v_beta;
  double vc = -0.5 * v_alpha - HALF_SQRT3 * v_beta;

  double inv_vdc = 1.0 / st->v_dc;
  st->duty_a = clamp_duty(0.5 + va * inv_vdc);
  st->duty_b = clamp_duty(0.5 + vb * inv_vdc);
  st->duty_c = clamp_duty(0.5 + vc * inv_vdc);
}
