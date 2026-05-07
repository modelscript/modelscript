// name: StreamUnbalancedConnector
// keywords: stream connector unbalanced
// status: incorrect
//
// Checks that unbalanced stream connectors generate an error message.
//

connector S
  Real r;
  stream Real s;
end S;

// Result:
// Error processing file: StreamUnbalancedConnector.mo
// Error: Failed to load package StreamUnbalancedConnector (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class StreamUnbalancedConnector not found in scope <top>.
// Error: Error occurred while flattening model StreamUnbalancedConnector
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
