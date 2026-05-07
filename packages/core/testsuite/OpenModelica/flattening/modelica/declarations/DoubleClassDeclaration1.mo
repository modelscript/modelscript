// name:     DoubleClassDeclaration1.mo
// status:   incorrect
//
// Checks that duplicate top-level classes are detected.
//

model M
end M;

model M
end M;

// Result:
// Error processing file: DoubleClassDeclaration1.mo
// [OpenModelica/flattening/modelica/declarations/DoubleClassDeclaration1.mo:7:1-8:6:writable] Notification: From here:
// [OpenModelica/flattening/modelica/declarations/DoubleClassDeclaration1.mo:10:1-12:6:writable] Error: An element with name M is already declared in this scope.
// Error: Failed to load package DoubleClassDeclaration1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class DoubleClassDeclaration1.mo not found in scope <top>.
// Error: Error occurred while flattening model DoubleClassDeclaration1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
