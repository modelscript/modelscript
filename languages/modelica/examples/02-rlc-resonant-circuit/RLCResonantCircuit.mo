model RLCResonantCircuit "Underdamped series RLC resonant circuit"
  parameter Real R(unit="Ohm") = 4.0 "Series resistance";
  parameter Real L(unit="H") = 0.025 "Series inductance";
  parameter Real C(unit="F") = 100e-6 "Series capacitance";
  parameter Real V_amp(unit="V") = 24.0 "AC source amplitude";
  parameter Real f_drive(unit="Hz") = 100.66 "Driving frequency near resonance";
  constant Real pi = 3.141592653589793;

  Real v_src(unit="V") "Source voltage";
  Real i(unit="A", start=0.0, fixed=true) "Series loop current";
  Real v_C(unit="V", start=0.0, fixed=true) "Capacitor voltage";
  Real v_L(unit="V") "Inductor voltage";
  Real v_R(unit="V") "Resistor voltage";
  Real E_stored(unit="J") "Total electromagnetic stored energy";

equation
  v_src = V_amp * sin(2.0 * pi * f_drive * time);
  v_R = R * i;
  v_L = L * der(i);
  C * der(v_C) = i;
  v_src = v_R + v_L + v_C;
  E_stored = 0.5 * L * i * i + 0.5 * C * v_C * v_C;

  annotation(
    experiment(StartTime=0, StopTime=0.15, Tolerance=1e-6)
  );
end RLCResonantCircuit;
