// name:     ConnectFlowEffort
// keywords: connect,modification
// status:   incorrect
//
// Flow and effort variables may not be connected.
//

connector Connector1
  Real e;
end Connector1;

connector Connector2
  flow Real e;
end Connector2;

class ConnectFlowEffort2
  Connector1 c1;
  Connector2 c2;
equation
  connect(c2, c1);
end ConnectFlowEffort2;

// Result:
// Error processing file: ConnectFlowEffort2.mo
// Error: Failed to load package ConnectFlowEffort (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ConnectFlowEffort not found in scope <top>.
// Error: Error occurred while flattening model ConnectFlowEffort
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
