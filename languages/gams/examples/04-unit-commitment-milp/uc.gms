$title Thermal Power Plant Unit Commitment MILP
$include gen_data.inc

Sets
  g  thermal generators / g1, g2, g3 /
  t  time periods       / t1*t4 / ;

Parameters
  pmin(g)   minimum generation in MW         / g1 50,  g2 30,  g3 20 /
  pmax(g)   maximum generation in MW         / g1 200, g2 150, g3 100 /
  varC(g)   variable fuel cost USD per MWh   / g1 28,  g2 36,  g3 48 /
  fixC(g)   no-load commitment USD per hr    / g1 400, g2 280, g3 180 /
  load(t)   hourly system demand in MW       / t1 180, t2 290, t3 340, t4 240 / ;

Variables
  p(g,t)    power dispatch in MW
  u(g,t)    unit commitment binary status
  z         total operating cost in USD ;
Positive Variable p ;
Binary Variable u ;

Equations
  cost          total commitment and dispatch cost
  balance(t)    system power balance
  minOut(g,t)   generator minimum stable output
  maxOut(g,t)   generator maximum capacity ;

cost..         z =e= sum((g,t), fixC(g)*u(g,t) + varC(g)*p(g,t)) ;
balance(t)..   sum(g, p(g,t)) =g= load(t) ;
minOut(g,t)..  p(g,t) =g= pmin(g)*u(g,t) ;
maxOut(g,t)..  p(g,t) =l= pmax(g)*u(g,t) ;

Model unit_commit / all / ;
Solve unit_commit using mip minimizing z ;
Display u.l, p.l, z.l ;
