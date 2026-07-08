package Examples
  import Examples.Components.*;

  model BouncingBall
    parameter Real e = 0.8 "Coefficient of restitution";
    parameter Real g = 9.81 "Gravity";
    Real h(start = 1.0) "Height";
    Real v(start = 0.0) "Velocity";
  equation
    der(h) = v;
    der(v) = -g;
    when h <= 0.0 and v < 0.0 then
      reinit(v, -e * pre(v));
    end when;
  end BouncingBall;

  model SimpleCircuit
    Resistor R1(R = 100);
    Capacitor C1(C = 0.01, v(start = 0.0));
    VoltageSource V1(V = 5.0);
    Ground G;
  equation
    connect(V1.p, R1.p);
    connect(R1.n, C1.p);
    connect(C1.n, G.p);
    connect(V1.n, G.p);
  end SimpleCircuit;

end Examples;
