/* Clamped Discrete-Time PID Controller with Anti-Windup */

double pid_step(
    double kp,
    double ki,
    double kd,
    double out_min,
    double out_max,
    double *integral,
    double *prev_error,
    double setpoint,
    double measurement,
    double dt) {
  double error = setpoint - measurement;
  double p_term = kp * error;
  double next_integral = (*integral) + error * dt;
  double i_term = ki * next_integral;
  double d_term = 0.0;
  double raw_out = 0.0;
  double clamped_out = 0.0;

  if (dt > 1.0e-9) {
    d_term = kd * (error - (*prev_error)) / dt;
  }

  raw_out = p_term + i_term + d_term;
  clamped_out = raw_out;

  if (raw_out > out_max) {
    clamped_out = out_max;
  } else if (raw_out < out_min) {
    clamped_out = out_min;
  } else {
    *integral = next_integral;
  }

  *prev_error = error;
  return clamped_out;
}
