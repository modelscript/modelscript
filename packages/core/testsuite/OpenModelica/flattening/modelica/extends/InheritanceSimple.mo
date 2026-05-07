// name: InheritanceSimple
// keywords: inheritance
// status: correct
//
// Tests simple inheritance
//

class A
  parameter Real a;
end A;

class B
  extends A;
end B;

// Result:
// Error processing file: InheritanceSimple.mo
// Error: Failed to load package InheritanceSimple (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class InheritanceSimple not found in scope <top>.
// Error: Error occurred while flattening model InheritanceSimple
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
