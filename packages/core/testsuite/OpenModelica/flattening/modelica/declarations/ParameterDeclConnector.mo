// name: ParameterDeclConnector
// keywords: parameter
// status: correct
//
// Tests the parameter prefix on a connector type
//

connector ParameterConnector
  Real r;
  flow Real f;
end ParameterConnector;

class ParameterDeclConnector
  parameter ParameterConnector pc;
equation
  pc.r = 1.0;
end ParameterDeclConnector;

// Result:
// Error processing file: ParameterDeclConnector.mo
// [OpenModelica/flattening/modelica/declarations/ParameterDeclConnector.mo:14:3-14:34:writable] Error: Invalid variability parameter on connector 'pc'.
// Error: Error occurred while flattening model ParameterDeclConnector
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
