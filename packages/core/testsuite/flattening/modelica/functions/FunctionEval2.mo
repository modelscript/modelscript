// name:     FunctionEval2
// keywords: function, if statement
// status:   correct
//
//

function f
  input Real x;
  output Real y;
algorithm
  if (x == 1) then
    y := x + 1;
  else
    y := x + 2;
  end if;
end f;

model FunctionEval2
  parameter Real x = f(1);
end FunctionEval2;




// Result:
// class FunctionEval2
//   parameter Real x = 2.0;
// end FunctionEval2;
// endResult
