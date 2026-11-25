/* Second-Order Direct-Form II Transposed IIR Biquad Filter */

double biquad_process(
    double b0,
    double b1,
    double b2,
    double a1,
    double a2,
    double *z1,
    double *z2,
    double x) {
  double y = b0 * x + (*z1);
  double next_z1 = b1 * x - a1 * y + (*z2);
  double next_z2 = b2 * x - a2 * y;

  *z1 = next_z1;
  *z2 = next_z2;
  return y;
}
