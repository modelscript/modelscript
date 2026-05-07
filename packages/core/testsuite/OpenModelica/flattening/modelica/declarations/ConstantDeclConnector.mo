// name: ConstantDeclConnector
// keywords: constant
// status: correct
//
// Tests the constant prefix used on a connector
//

connector ConstantConnector
  Real r;
  flow Real f;
end ConstantConnector;

model ConstantDeclConnector
  constant ConstantConnector cc(r = 2.0);
end ConstantDeclConnector;

// Result:
// Error processing file: ConstantDeclConnector.mo
// [OpenModelica/flattening/modelica/declarations/ConstantDeclConnector.mo:14:3-14:41:writable] Error: Invalid variability constant on connector 'cc'.
// Error: Error occurred while flattening model ConstantDeclConnector
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
