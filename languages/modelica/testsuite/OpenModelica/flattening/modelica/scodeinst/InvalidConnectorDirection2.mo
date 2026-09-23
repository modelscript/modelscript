// name: InvalidConnectorDirection2
// keywords:
// status: incorrect
//

model InvalidConnectorDirection2
  connector C = Real;
  connector C2 = input Real;

  C c1;
  C2 c2;
equation
  connect(c1, c2);
end InvalidConnectorDirection2;

// Result:
// class InvalidConnectorDirection2
//   Real c1;
//   input Real c2;
// equation
//   c1 = c2;
// end InvalidConnectorDirection2;
// endResult
