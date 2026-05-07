// name:     OneArgBaseFunction
// keywords: Inheritance
// status:   correct
//
// Tests inheritance in many steps
//
// Drmodelica: 9.2 Partial Base Function (p. 308)
//

partial function OneArgBaseFunction
  input Real x;
  output Real result;
end OneArgBaseFunction;

function myTan
  extends OneArgBaseFunction;
algorithm
  result := sin(x)/cos(x);
end myTan;

function addTen
  extends OneArgBaseFunction;
algorithm
  result := x + 10;
end addTen;

class myTanCall
  Real t;
equation
  t = myTan(1.0);
end myTanCall;

// Result:
// Error processing file: OneArgBaseFunction.mo
// [OpenModelica/flattening/modelica/extends/OneArgBaseFunction.mo:10:1-13:23:writable] Error: Cannot instantiate OneArgBaseFunction due to class specialization function.
// Error: Error occurred while flattening model OneArgBaseFunction
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
