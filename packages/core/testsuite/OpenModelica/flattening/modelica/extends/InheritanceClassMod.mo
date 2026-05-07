// name: InheritanceClassMod
// keywords: inheritance
// status: correct
//
// Tests simple inheritance with class modifications
//

class A
  parameter Real a;
end A;

class B
  extends A(a = 2.0);
end B;

// Result:
// Error processing file: InheritanceClassMod.mo
// Error: Failed to load package InheritanceClassMod (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class InheritanceClassMod not found in scope <top>.
// Error: Error occurred while flattening model InheritanceClassMod
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
