model ChuaOscillator "Chua's double-scroll chaotic electronic oscillator"
  parameter Real alpha = 15.6 "Capacitance ratio C2/C1";
  parameter Real beta = 28.0 "Normalized inductance parameter";
  parameter Real m0 = -1.143 "Inner slope of piecewise-linear Chua diode";
  parameter Real m1 = -0.714 "Outer slope of piecewise-linear Chua diode";

  Real x(start=0.7, fixed=true) "Normalized voltage across C1";
  Real y(start=0.0, fixed=true) "Normalized voltage across C2";
  Real z(start=0.0, fixed=true) "Normalized inductor current";
  Real h "Chua diode nonlinear current characteristic";

equation
  h = m1 * x + 0.5 * (m0 - m1) * (abs(x + 1.0) - abs(x - 1.0));
  der(x) = alpha * (y - x - h);
  der(y) = x - y + z;
  der(z) = -beta * y;

  annotation(
    experiment(StartTime=0, StopTime=60, Tolerance=1e-7)
  );
end ChuaOscillator;
