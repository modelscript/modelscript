// name: InvalidConnectorType2
// keywords:
// status: incorrect
//

model InvalidConnectorType2
  connector C = Real;
  connector C2 = flow Real;

  C c1;
  C2 c2;
equation
  connect(c1, c2);
end InvalidConnectorType2;

// Result:
// class InvalidConnectorType2
//   Real c1;
//   Real c2;
// equation
//   c1 = c2;
//   c2 = 0.0;
// end InvalidConnectorType2;
// endResult
