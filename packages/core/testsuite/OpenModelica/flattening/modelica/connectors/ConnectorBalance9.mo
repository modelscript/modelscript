// name: ConnectorBalance9
// keywords: connector
// status: correct
//
//

connector C
  Real e1;
  Real e2;
  flow Real f1;
end C;

model ConnectorBalance9
  C c1, c2;
equation
  connect(c1, c2);
end ConnectorBalance9;

// Result:
// class ConnectorBalance9
//   Real c1.e1;
//   Real c1.e2;
//   Real c1.f1;
//   Real c2.e1;
//   Real c2.e2;
//   Real c2.f1;
// equation
//   c1.e1 = c2.e1;
//   c1.e2 = c2.e2;
//   -(c1.f1 + c2.f1) = 0.0;
//   c1.f1 = 0.0;
//   c2.f1 = 0.0;
// end ConnectorBalance9;
// [OpenModelica/flattening/modelica/connectors/ConnectorBalance9.mo:14:3-14:11:writable] Warning: Connector c1 is not balanced: The number of potential variables (2) is not equal to the number of flow variables (1).
// [OpenModelica/flattening/modelica/connectors/ConnectorBalance9.mo:14:3-14:11:writable] Warning: Connector c2 is not balanced: The number of potential variables (2) is not equal to the number of flow variables (1).
// endResult
