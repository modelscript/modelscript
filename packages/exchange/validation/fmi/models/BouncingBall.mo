model BouncingBall     "The bouncing ball model"
  Real g(start = -9.81);
  parameter Real e = 0.7;   // Elasticity constant of ball
  parameter Real v_min = 0.1;
  Real h(start = 1);        // height above ground
  Real v(start = 0);        // Velocity of the ball
equation
  der(h) = v;
  der(v) = g;
  der(g) = 0;
  
  when h <= 0 and v < 0 and -e*pre(v) >= v_min then
    reinit(v, -e*pre(v));
  end when;
  
  when h <= 0 and v < 0 and -e*pre(v) < v_min then
    reinit(v, 0);
    reinit(g, 0);
  end when;
  

end BouncingBall;
