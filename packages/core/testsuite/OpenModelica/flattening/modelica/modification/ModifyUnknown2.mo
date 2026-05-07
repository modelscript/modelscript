// name:     ModifyUnknown2
// keywords: modification
// status:   incorrect
//
// Try to introduce a new member via modification.
//

class A
  Real a;
end A;

class ModifyUnknown2 = A(redeclare Real b = 5) 

// Result:
// Error processing file: ModifyUnknown2.mo
// [OpenModelica/flattening/modelica/modification/ModifyUnknown2.mo:24:0-24:0:writable] Error: Missing token: SEMICOLON
// Error: Failed to load package ModifyUnknown2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ModifyUnknown2 not found in scope <top>.
// Error: Error occurred while flattening model ModifyUnknown2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
