#ifndef MATH_LUT_H
#define MATH_LUT_H

#define INV_SQRT3  0.5773502691896258
#define HALF_SQRT3 0.8660254037844386

static inline double clamp_duty(double d) {
  double out = d;
  if (out > 0.98) {
    out = 0.98;
  } else if (out < 0.02) {
    out = 0.02;
  }
  return out;
}

#endif
