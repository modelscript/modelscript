// name:     FunctionEval7
// keywords: function, nested function call, for loop
// status:   correct
//
//

function g
  input Real x;
  output Real y;
algorithm
  y := x;
end g;

function f
  input Real x;
  output Real y;
algorithm
  y := x;
  for i in 1:10 loop
    y := y + g(1);
  end for;
end f;

model FunctionEval7
  parameter Real x = f(3);
end FunctionEval7;




// Result:
// class FunctionEval7
//   parameter Real x = 13.0;
// end FunctionEval7;
// endResult
