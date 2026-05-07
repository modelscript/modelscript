// name: ParameterDeclRecord
// keywords: parameter
// status: correct
//
// Tests the parameter prefix on a record type
//

record ParameterRecord
  Real r;
end ParameterRecord;

class ParameterDeclRecord
  parameter ParameterRecord pr;
equation
  pr.r = 1.0;
end ParameterDeclRecord;

// Result:
// Error processing file: ParameterDeclRecord.mo
// [OpenModelica/flattening/modelica/declarations/ParameterDeclRecord.mo:13:3-13:31:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/ParameterDeclRecord.mo:15:3-15:13:writable] Warning: Equation sections are deprecated in class.
// [OpenModelica/flattening/modelica/declarations/ParameterDeclRecord.mo:9:3-9:9:writable] Error: Parameter pr.r has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model ParameterDeclRecord
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
