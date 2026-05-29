// name: ConnectorBalance3
// keywords: connector
// status: correct
//
//

connector C
  Real e;
end C;

model ConnectorBalance3
  C c;
end ConnectorBalance3;

// Result:
// class ConnectorBalance3
//   Real c.e;
// end ConnectorBalance3;
// endResult
