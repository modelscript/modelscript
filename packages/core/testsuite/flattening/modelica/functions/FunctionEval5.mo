// name:     FunctionEval5
// keywords: function, while loop
// status:   correct
//
//

function f
  input Real x;
  output Real y;
algorithm
  y := x;
  while y < 10 loop
    y := y + 1;
  end while;
end f;

model FunctionEval5
  parameter Real x = f(3);
end FunctionEval5;




// Result:
// class FunctionEval5
//   parameter Real x = 10.0;
// end FunctionEval5;
// endResult
