// name:     Inline2
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
  outInt := inInt + simpleInline2(inInt + 10);
end simpleInline;

function simpleInline2
  input Integer inInt2;
  output Integer outInt2;
  annotation(Inline = true);
algorithm
  outInt2 := inInt2 * 3;
end simpleInline2;

model Inline2
  Integer x;
  Integer y;
equation
  x = 2;
  y = (2 + simpleInline(x)) * (simpleInline(x + 8) / 2);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Inline2;

// Result:
// function simpleInline
//   input Integer inInt;
//   output Integer outInt;
// algorithm
//   outInt := inInt + simpleInline2(10 + inInt);
// end simpleInline;
//
// function simpleInline2
//   input Integer inInt2;
//   output Integer outInt2;
// algorithm
//   outInt2 := 3 * inInt2;
// end simpleInline2;
//
// class Inline2
//   Integer x;
//   Integer y;
// equation
//   x = 2;
//   /*Real*/(y) = 0.5 * /*Real*/(2 + simpleInline(x)) * /*Real*/(simpleInline(8 + x));
// end Inline2;
// endResult
