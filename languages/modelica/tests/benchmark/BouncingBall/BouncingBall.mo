model BouncingBall
  parameter Real e = 0.7 "coefficient of restitution";
  parameter Real g = 9.81 "gravity acceleration";
  Real h(start=1.0) "height of ball";
  Real v(start=0.0) "velocity of ball";
equation
  der(h) = v;
  der(v) = -g;
  when h < 0.0 then
    reinit(v, -e*pre(v));
  end when;
end BouncingBall;
