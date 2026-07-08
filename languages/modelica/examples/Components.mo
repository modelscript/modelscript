package Components
  "Basic electrical components for circuit modeling"

  connector Pin
    Real v "Voltage";
    flow Real i "Current";
  end Pin;

  partial model TwoPin
    Pin p "Positive pin";
    Pin n "Negative pin";
    Real v "Voltage drop";
    Real i "Current flowing through component";
  equation
    v = p.v - n.v;
    0 = p.i + n.i;
    i = p.i;
  end TwoPin;

  model Resistor
    extends TwoPin;
    parameter Real R(min=0) "Resistance";
  equation
    v = R * i;
  end Resistor;

  model Capacitor
    extends TwoPin;
    parameter Real C(min=0) "Capacitance";
  equation
    i = C * der(v);
  end Capacitor;

  model VoltageSource
    extends TwoPin;
    parameter Real V "Voltage";
  equation
    v = V;
  end VoltageSource;

  model Ground
    Pin p;
  equation
    p.v = 0.0;
  end Ground;

end Components;
