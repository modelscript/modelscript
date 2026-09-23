// name: InvalidConnectorDirection1
// keywords:
// status: incorrect
//

model InvalidConnectorDirection1
  connector C = input Real;
  connector C2 = Real;

  C c1;
  C2 c2;
equation
  connect(c1, c2);
end InvalidConnectorDirection1;

// Result:
// class InvalidConnectorDirection1
//   input Real c1;
//   Real c2;
// equation
//   c1 = c2;
// end InvalidConnectorDirection1;
// endResult
