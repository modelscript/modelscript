// name: ConnectNonConnector4
// keywords:
// status: incorrect
//

model ConnectNonConnector4
  Real x, y;
equation
  connect(x, y);
end ConnectNonConnector4;

// Result:
// Error processing file: ConnectNonConnector4.mo
// [OpenModelica/flattening/modelica/scodeinst/ConnectNonConnector4.mo:9:3-9:16:writable] Error: x is not a valid connector.
// Error: Error occurred while flattening model ConnectNonConnector4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
