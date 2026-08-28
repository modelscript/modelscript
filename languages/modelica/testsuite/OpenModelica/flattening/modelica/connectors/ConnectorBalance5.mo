// name: ConnectorBalance5
// keywords: connector
// status: correct
//
//

record R
  Real x;
end R;

connector C
  Real e;
  flow Real f;
  R r;
end C;

model ConnectorBalance5
  C c;
end ConnectorBalance5;

// Result:
// class ConnectorBalance5
//   Real c.e;
//   Real c.f;
//   Real c.r.x;
// equation
//   c.f = 0.0;
// end ConnectorBalance5;
// endResult
