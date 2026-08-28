// name:     Faculty4
// keywords: equation,array
// status:   correct
//
// Definition of faculty using equations. It is a matter of
// quality of implementation if the model can be treated with
// 'x' being a parameter. In the expected result given here 'x'
// is treated constant.
//

function multiply
  input Real x;
  input Real y;
  output Real z;
algorithm
  z:=x*y;
end multiply;

block Faculty4
  parameter Integer x(min = 0) = 4;
  output Integer y;
protected
  Integer work[x];
equation
  if x < 2 then
    y = 1;
  else
    y = work[x];
    work[x:-1:2] = multiply(work[x-1:-1:1],(ones(x-1) + work[x-1:-1:1]));
    work[1] = 1;
  end if;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Faculty4;

// Result:
// function multiply
//   input Real x;
//   input Real y;
//   output Real z;
// algorithm
//   z := x * y;
// end multiply;
//
// class Faculty4
//   parameter Integer x(min = 0) = 4;
//   output Integer y;
//   protected Integer work[1];
//   protected Integer work[2];
//   protected Integer work[3];
//   protected Integer work[4];
// equation
//   y = work[4];
//   /*Real*/(work[4]) = multiply(/*Real*/(work[3]), /*Real*/(1 + work[3]));
//   /*Real*/(work[3]) = multiply(/*Real*/(work[2]), /*Real*/(1 + work[2]));
//   /*Real*/(work[2]) = multiply(/*Real*/(work[1]), /*Real*/(1 + work[1]));
//   work[1] = 1;
// end Faculty4;
// endResult
