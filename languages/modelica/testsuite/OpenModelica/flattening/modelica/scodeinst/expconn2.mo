// name: expconn2.mo
// keywords:
// status: correct
//
// FAILREASON: Expandable connectors not handled yet.
//

expandable connector EC
  C c;
end EC;

connector C
  Real e;
  flow Real f;
end C;

model M
  EC ec;
  C c;
equation
  connect(ec.c, c);
end M;

// Result:
// class M
//   Real ec.c.e;
//   Real ec.c.f;
//   Real c.e;
//   Real c.f;
// equation
//   ec.c.e = c.e;
//   -(ec.c.f + c.f) = 0.0;
//   ec.c.f = 0.0;
//   c.f = 0.0;
// end M;
// endResult
