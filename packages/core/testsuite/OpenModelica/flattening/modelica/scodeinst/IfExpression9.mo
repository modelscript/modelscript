// name: IfExpression9
// keywords:
// status: correct
//

model IfExpression9
  parameter Boolean b = true;
  Real x[2] = if b then {1, 2} + x else {3, 4, 5} + x;
end IfExpression9;

// Result:
// Error processing file: IfExpression9.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/IfExpression9.mo:8:3-8:54:writable] Error: Cannot resolve type of expression {3.0, 4.0, 5.0} + x. The operands have types Integer[3], Real[2] in component <NO_COMPONENT>.
//
// Execution failed!
// endResult
