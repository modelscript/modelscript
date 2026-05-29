// name: InvalidConnectorDirection3
// keywords:
// status: incorrect
//

model InvalidConnectorDirection3
  connector C
    input Real x;
    Real y;
    flow Real f;
  end C;

  connector C2
    Real x;
    input Real y;
    flow Real f;
  end C2;

  C c1;
  C2 c2;
equation
  connect(c1, c2);
end InvalidConnectorDirection3;

// Result:
// class InvalidConnectorDirection3
//   input Real c1.x;
//   Real c1.y;
//   Real c1.f;
//   Real c2.x;
//   input Real c2.y;
//   Real c2.f;
// equation
//   c1.x = c2.x;
//   c1.y = c2.y;
//   -(c1.f + c2.f) = 0.0;
//   c1.f = 0.0;
//   c2.f = 0.0;
// end InvalidConnectorDirection3;
// endResult
