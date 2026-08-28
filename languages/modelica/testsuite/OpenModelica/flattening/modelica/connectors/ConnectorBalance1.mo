// name: ConnectorBalance1
// keywords: connector
// status: correct
//
// Tests an illegal connector definition
//

connector IllegalConnector = Real;

model ConnectorBalance1
  IllegalConnector ic;
end ConnectorBalance1;

// Result:
// class ConnectorBalance1
//   Real ic;
// end ConnectorBalance1;
// endResult
