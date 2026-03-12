// name:     FunctionEval3
// keywords: function, if statement, else branch
// status:   correct
//
//

function f
  input Real x;
  output Real y;
algorithm
  if x == 1 then
    y := x + 1;
  else
    y := x + 2;
  end if;
end f;

model FunctionEval3
  parameter Real x = f(2);
end FunctionEval3;




// Result:
// class FunctionEval3
//   parameter Real x = 4.0;
// end FunctionEval3;
// endResult
