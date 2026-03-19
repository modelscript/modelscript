// name:     Inline3
// keywords: inline, function
// status:   correct
//
// Test case for inline annotations
//

function inlineFac
  input Integer n;
  output Integer res;
  annotation(Inline = true);
algorithm
  res := if n == 1 then 1 else n * inlineFac(n - 1);
end inlineFac;

model Inline3
  Integer x;
  Integer y;
equation
  x = 5;
  y = inlineFac(x);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Inline3;

// Result:
// function inlineFac
//   input Integer n;
//   output Integer res;
// algorithm
//   res := if n == 1 then 1 else n * inlineFac(-1 + n);
// end inlineFac;
//
// class Inline3
//   Integer x;
//   Integer y;
// equation
//   x = 5;
//   y = inlineFac(x);
// end Inline3;
// endResult
