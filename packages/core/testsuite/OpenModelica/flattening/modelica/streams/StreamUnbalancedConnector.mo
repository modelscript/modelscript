// name: StreamUnbalancedConnector
// keywords: stream connector unbalanced
// status: incorrect
//
// Checks that unbalanced stream connectors generate an error message.
//

connector S
  Real r;
  stream Real s;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end S;

// Result:
// Error processing file: StreamUnbalancedConnector.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/streams/StreamUnbalancedConnector.mo:8:1-12:6:writable] Error: Invalid stream connector .S: A stream connector must have exactly one flow variable, this connector has 0 flow variables.
// Error: Error occurred while flattening model S
//
// Execution failed!
// endResult
