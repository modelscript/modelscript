// name: ConnectNonConnector1
// keywords:
// status: incorrect
//

model ConnectNonConnector1
equation
  connect(Boolean, Boolean);
end ConnectNonConnector1;

// Result:
// Error processing file: ConnectNonConnector1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/ConnectNonConnector1.mo:8:3-8:28:writable] Error: Boolean is not a valid connector.
//
// Execution failed!
// endResult
