// name:     FunctionEval4
// keywords: function, for loop
// status:   correct
//
//

function f
  input Real x;
  output Real y;
algorithm
  y := x;
  for i in 1:10 loop
    y := y + 1;
  end for;
end f;

model FunctionEval4
  parameter Real x = f(3);
end FunctionEval4;




// Result:
// class FunctionEval4
//   parameter Real x = 13.0;
// end FunctionEval4;
// endResult
