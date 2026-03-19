// name:     Inline1
// keywords: inline, function
// status:   correct
//
// Test case for inline annotations
//

function simpleInline
  input Integer inInt;
  output Integer outInt;
  annotation(Inline = true);
algorithm
  outInt := (inInt + 2 + 3 - inInt) * inInt;
end simpleInline;

model Inline1
  Integer x;
  Integer y;
equation
  x = 2;
  y = (2 + simpleInline(x)) * (simpleInline(x + 8) / 2);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Inline1;

// Result:
// function simpleInline
//   input Integer inInt;
//   output Integer outInt;
// algorithm
//   outInt := 5 * inInt;
// end simpleInline;
//
// class Inline1
//   Integer x;
//   Integer y;
// equation
//   x = 2;
//   /*Real*/(y) = 0.5 * /*Real*/(2 + simpleInline(x)) * /*Real*/(simpleInline(8 + x));
// end Inline1;
// endResult
