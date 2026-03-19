// name:     Inline5
// keywords: inline, function
// status:   correct
//
// Test case for inline annotations
//

model Inline5

function simpleInline
  input Integer inInt;
  output Integer outInt;
  annotation(Inline = true);
algorithm
  outInt := (inInt + 2 + 3 - inInt) * inInt;
end simpleInline;

  Integer x;
  Integer y;
equation
  x = 2;
  y = (2 + simpleInline(x)) * (simpleInline(x + 8) / 2);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Inline5;

// Result:
// function Inline5.simpleInline
//   input Integer inInt;
//   output Integer outInt;
// algorithm
//   outInt := 5 * inInt;
// end Inline5.simpleInline;
//
// class Inline5
//   Integer x;
//   Integer y;
// equation
//   x = 2;
//   /*Real*/(y) = 0.5 * /*Real*/(2 + Inline5.simpleInline(x)) * /*Real*/(Inline5.simpleInline(8 + x));
// end Inline5;
// endResult
