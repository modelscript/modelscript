// name: RedeclareElementCondition2
// keywords:
// status: incorrect
//

model A
  replaceable Real x = 1.0 if false;
end A;

model RedeclareElementCondition2
  extends A;

  redeclare Real x if true;
end RedeclareElementCondition2;

// Result:
// Error processing file: RedeclareElementCondition2.mo
// [OpenModelica/flattening/modelica/scodeinst/RedeclareElementCondition2.mo:13:3-13:27:writable] Error: Invalid redeclaration of x, a redeclare may not have a condition attribute.
// Error: Error occurred while flattening model RedeclareElementCondition2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
