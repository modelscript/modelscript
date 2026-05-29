// name: InvalidConnectorType1
// keywords:
// status: incorrect
//

model InvalidConnectorType1
  connector C = flow Real;
  connector C2 = Real;

  C c1;
  C2 c2;
equation
  connect(c1, c2);
end InvalidConnectorType1;

// Result:
// class InvalidConnectorType1
//   Real c1;
//   Real c2;
// equation
//   -(c1 + c2) = 0.0;
//   c1 = 0.0;
// end InvalidConnectorType1;
// endResult
