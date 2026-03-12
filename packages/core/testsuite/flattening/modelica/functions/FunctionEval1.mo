// name:     FunctionEval1
// keywords: function
// status:   correct
//
// Tests evaluation of a simple function call in a parameter binding.
//

function f
  input Integer x;
  output Integer y;
algorithm
  y := x + 1;
end f;

model FunctionEval1
  parameter Integer x = f(1);
end FunctionEval1;

// Result:
// class FunctionEval1
//   parameter Integer x = 2;
// end FunctionEval1;
// endResult
