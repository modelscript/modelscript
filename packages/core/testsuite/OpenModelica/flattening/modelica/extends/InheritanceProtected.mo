// name: InheritanceProtected
// keywords: inheritance
// status: correct
//
// Tests protected inheritance
//

class A
  parameter Real a;
end A;

class B
  protected extends A;
end B;

// Result:
// Error processing file: InheritanceProtected.mo
// Error: Failed to load package InheritanceProtected (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class InheritanceProtected not found in scope <top>.
// Error: Error occurred while flattening model InheritanceProtected
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
