// name: InheritanceSeveral
// keywords: inheritance
// status: correct
//
// Tests simple inheritance in several steps
//

class A
  parameter Real a;
end A;

class B
  extends A;
  parameter Real b;
end B;

class C
  extends B;
end C;

// Result:
// Error processing file: InheritanceSeveral.mo
// Error: Failed to load package InheritanceSeveral (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class InheritanceSeveral not found in scope <top>.
// Error: Error occurred while flattening model InheritanceSeveral
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
