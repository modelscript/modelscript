// name: IfExpCombiTable1
// status: correct
// This should succeed without error messages

class IfExpCombiTable1
  parameter Boolean b = false;
  Real r = if not b then 1.5 else q();
end IfExpCombiTable1;

// Result:
// Error processing file: IfExpCombiTable1.mo
// [OpenModelica/flattening/modelica/others/IfExpCombiTable1.mo:6:3-6:30:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/others/IfExpCombiTable1.mo:7:3-7:38:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/others/IfExpCombiTable1.mo:7:3-7:38:writable] Error: Function q not found in scope IfExpCombiTable1.
// Error: Error occurred while flattening model IfExpCombiTable1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
