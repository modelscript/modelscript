// name:     Min & Max
// keywords: builtin functions min max
// status:   correct
//
// Usage of the min and max functions
model MinMax
  Real x[max(n,m)];
  Real y[max([n,m])];
  parameter Integer n=min(m,3);
  parameter Integer m = 4;
  constant Boolean bemptyarr[0]=fill(true, 0);
  constant Boolean b1 = min(true,false);
  constant Boolean b2 = min({true,true,false});
  constant Boolean b3 = min(bemptyarr);
  constant Boolean b4 = max(true,false);
  constant Boolean b5 = max({true,true,false});
  constant Boolean b6 = max(bemptyarr);
equation
  x= fill(1.0,max(n,m));
end MinMax;
// Result:
// class Sign
//   Real r1;
//   Real r2;
// equation
//   r1 = 1.0;
//   r2 = -1.0;
// end Sign;
// endResult
