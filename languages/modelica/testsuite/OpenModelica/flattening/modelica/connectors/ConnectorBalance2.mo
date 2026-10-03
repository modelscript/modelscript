// name: ConnectorBalance2
// keywords: connector
// status: correct
//
// Tests an illegal connector definition
//

connector IllegalConnector = flow Real;

model ConnectorBalance2
  IllegalConnector ic;
end ConnectorBalance2;

// Result:
// class ConnectorBalance2
//   Real ic;
// equation
//   ic = 0.0;
// end ConnectorBalance2;
// endResult
