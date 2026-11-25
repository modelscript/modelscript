#ifndef FOC_H
#define FOC_H

typedef struct {
  double kp;
  double ki;
  double v_dc;
  double int_d;
  double int_q;
  double duty_a;
  double duty_b;
  double duty_c;
} FocState;

void foc_step(FocState *st, double ia, double ib, double sin_th, double cos_th, double iq_ref, double dt);

#endif
