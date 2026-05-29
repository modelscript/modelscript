// name:     DeclareConstant2
// keywords: declaration
// status:   incorrect
//
// The attribute 'value' shall not be accessed.
//

class DeclareConstant2
  constant String s(value = "value");
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end DeclareConstant2;

// Result:
// Error processing file: DeclareConstant2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/declarations/DeclareConstant2.mo:9:21-9:36:writable] Error: Modified element value not found in class Real.
// Error: Error occurred while flattening model DeclareConstant2
//
// Execution failed!
// endResult
