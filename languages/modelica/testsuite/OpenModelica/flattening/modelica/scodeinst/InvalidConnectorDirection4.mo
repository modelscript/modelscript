// name: InvalidConnectorDirection4
// keywords:
// status: incorrect
//

model InvalidConnectorDirection4
  connector C
    flow Real f;
    Real y;
    input Real x;
  end C;

  connector C2
    flow Real f;
    input Real y;
    Real x;
  end C2;

  C c1;
  C2 c2;
equation
  connect(c1, c2);
end InvalidConnectorDirection4;

// Result:
// class InvalidConnectorDirection4
//   Real c1.f;
//   Real c1.y;
//   input Real c1.x;
//   Real c2.f;
//   input Real c2.y;
//   Real c2.x;
// equation
//   c1.x = c2.x;
//   c1.y = c2.y;
//   -(c1.f + c2.f) = 0.0;
//   c1.f = 0.0;
//   c2.f = 0.0;
// end InvalidConnectorDirection4;
// endResult
