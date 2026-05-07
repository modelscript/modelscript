// name:     ModifyUnknown1
// keywords: modification
// status:   incorrect
//
// Try to introduce a new member via modification.
//

class A
  Real a;
end A;

class ModifyUnknown1 = A(b = 5) 

// Result:
// Error processing file: ModifyUnknown1.mo
// [OpenModelica/flattening/modelica/modification/ModifyUnknown1.mo:24:0-24:0:writable] Error: Missing token: SEMICOLON
// Error: Failed to load package ModifyUnknown1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ModifyUnknown1 not found in scope <top>.
// Error: Error occurred while flattening model ModifyUnknown1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
