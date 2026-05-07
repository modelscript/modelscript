// name: InheritanceMultiple
// keywords: inheritance:
// status: correct
//
// tests multiple inheritance
//

class Base1
  parameter Real baseReal1;
end Base1;

class Base2
  parameter Real baseReal2;
end Base2;

class InheritanceMultiple
  extends Base1(baseReal1 = 2.0);
  extends Base2(baseReal2 = 3.0);
  parameter Real finalReal;
end InheritanceMultiple;

// Result:
// Error processing file: InheritanceMultiple.mo
// [OpenModelica/flattening/modelica/extends/InheritanceMultiple.mo:19:3-19:27:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/extends/InheritanceMultiple.mo:19:3-19:27:writable] Error: Parameter finalReal has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model InheritanceMultiple
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
