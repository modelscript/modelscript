// name: InheritancePublic
// keywords: inheritance
// status: correct
//
// Tests public inheritance
//

class A
  parameter Real a;
end A;

class B
  public extends A;
end B;

// Result:
// Error processing file: InheritancePublic.mo
// Error: Failed to load package InheritancePublic (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class InheritancePublic not found in scope <top>.
// Error: Error occurred while flattening model InheritancePublic
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
