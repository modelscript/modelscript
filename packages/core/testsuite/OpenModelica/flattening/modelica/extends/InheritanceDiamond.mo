// name: InheritanceDiamond.mo
// keywords: inheritance
// status: correct
//
// Tests diamond inheritance
//

class SuperBase
  parameter Real superReal;
end SuperBase;

class Base1
  extends SuperBase(superReal = 2.0);
  parameter Real baseReal1;
end Base1;

class Base2
  extends SuperBase(superReal = 3.0);
  parameter Real baseReal2;
end Base2;

class InheritanceDiamond
  extends Base1(baseReal1 = 2.0);
  extends Base2(baseReal2 = 3.0);
  parameter Real finalReal;
end InheritanceDiamond;

// Result:
// Error processing file: InheritanceDiamond.mo
// [OpenModelica/flattening/modelica/extends/InheritanceDiamond.mo:9:3-9:27:writable] Error: Duplicate elements (due to inherited elements) not identical:
//   first element is:  parameter Real superReal = 2.0
//   second element is: parameter Real superReal = 3.0
// Error: Class InheritanceDiamond.mo not found in scope <top>.
// Error: Error occurred while flattening model InheritanceDiamond.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
