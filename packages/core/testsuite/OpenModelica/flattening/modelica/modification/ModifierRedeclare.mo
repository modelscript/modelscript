// name: ModifierRedeclare
// keywords: modifier, redeclare, replaceable
// status: correct
//
// Tests redeclarations
//

class A
  parameter Real x;
end A;

class B
  parameter Real x = 3.14, y;
end B;

class C
  replaceable A a(x = 1.0);
end C;

class D
  extends C(redeclare B a(y = 2.0));
end D;

// Result:
// Error processing file: ModifierRedeclare.mo
// Error: Failed to load package ModifierRedeclare (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ModifierRedeclare not found in scope <top>.
// Error: Error occurred while flattening model ModifierRedeclare
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
