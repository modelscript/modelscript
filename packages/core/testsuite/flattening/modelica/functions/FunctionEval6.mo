// name:     FunctionEval6
// keywords: function, complex assignment, procedure call
// status:   correct
//
//

function swap
  input Real a;
  input Real b;
  output Real c;
  output Real d;
algorithm
  c := b;
  d := a;
end swap;

function f
  input Real x;
  output Real y;
  protected
    Real a;
    Real b;
algorithm
  (a, b) := swap(x, x + 1);
  y := a + b;
end f;

model FunctionEval6
  parameter Real x = f(3);
end FunctionEval6;




// Result:
// class FunctionEval6
//   parameter Real x = 7.0;
// end FunctionEval6;
// endResult
