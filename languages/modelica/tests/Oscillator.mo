model Oscillator
  Real x(start = 1.0);
  Real v(start = 0.0);
equation
  der(x) = v;
  der(v) = -x;
end Oscillator;
