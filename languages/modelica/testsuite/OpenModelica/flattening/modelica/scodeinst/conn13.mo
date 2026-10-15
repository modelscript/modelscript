// name: conn13.mo
// keywords:
// status: correct
//
// FAILREASON: Overconstrained types are not recognized as such yet (need to add
//             equalityConstraint to their type).
//

type OC
  extends Real;

  function equalityConstraint
    input Real x;
    input Real y;
    output Real residue[0];
  algorithm
  end equalityConstraint;
end OC;

connector C
  OC oc;
  Real e[3];
  flow Real f[3];
end C;

model M
  C c1, c2;
equation
  Connections.branch(c1.oc, c2.oc);
  Connections.isRoot(c1.oc);
  connect(c1, c2);
end M;

// Result:
// class M
//   Real c1.oc;
//   Real c1.e[1];
//   Real c1.e[2];
//   Real c1.e[3];
//   Real c1.f[1];
//   Real c1.f[2];
//   Real c1.f[3];
//   Real c2.oc;
//   Real c2.e[1];
//   Real c2.e[2];
//   Real c2.e[3];
//   Real c2.f[1];
//   Real c2.f[2];
//   Real c2.f[3];
// equation
//   c1.e[1] = c2.e[1];
//   c1.e[2] = c2.e[2];
//   c1.e[3] = c2.e[3];
//   -(c1.f[1] + c2.f[1]) = 0.0;
//   -(c1.f[2] + c2.f[2]) = 0.0;
//   -(c1.f[3] + c2.f[3]) = 0.0;
//   c1.f[1] = 0.0;
//   c1.f[2] = 0.0;
//   c1.f[3] = 0.0;
//   c2.f[1] = 0.0;
//   c2.f[2] = 0.0;
//   c2.f[3] = 0.0;
// end M;
// endResult
