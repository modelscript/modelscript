// name:     Enumeration7
// keywords: enumeration enum
// status:   correct
//
//
//


package Types
  model EnumTest
    type E = enumeration(e1, e2);
    type Size = enumeration(small, medium, large, xlarge);
    Size t_shirt_size = Size.medium;
    type Size2 = enumeration(small "1st", medium "2nd", large "3rd", xlarge "4th");
    type DigitalCurrentChoices = enumeration(zero, one); // Similar to Real, Integer
    type DigitalCurrent = DigitalCurrentChoices(quantity="Current", start = one, fixed = true);
    DigitalCurrent c(start = DigitalCurrent.one, fixed = true);
    DigitalCurrentChoices choice(start = DigitalCurrentChoices.one, fixed = true);
    Real x[DigitalCurrentChoices];
    Real xx[DigitalCurrentChoices];
    Real xxx[DigitalCurrentChoices];
  algorithm
    // Example using the type name to represent the range
    for e in DigitalCurrentChoices loop
      x[e] := 0.0;
    end for;
    for e loop // Equivalent example using short form
      xx[e] := 0.0;
    end for;
    for e in DigitalCurrentChoices.zero : DigitalCurrentChoices.one loop
      xxx[e] := 0.0;
    end for;
  equation
    c = DigitalCurrent.one;
    choice = if c == DigitalCurrent.zero  then DigitalCurrent.one else DigitalCurrent.one;
  end EnumTest;

  type ResolveInFrameA =
     enumeration(world "Resolve in world frame",
                 frame_a "Resolve in frame_a",
                 frame_resolve "Resolve in frame_resolve (frame_resolve must be connected)");

  model Mixing1 "Mixing of multi-substance flows, alternative 1"
    replaceable type E=enumeration(:)"Substances in Fluid";
    input Real c1[E], c2[E], mdot1, mdot2;
    output Real c3[E], mdot3;
  equation
    0 = mdot1 + mdot2 + mdot3;
    for e in E loop
      0 = mdot1*c1[e] + mdot2*c2[e]+ mdot3*c3[e];
    end for;
    // Array operations on enumerations are NOT (yet) possible:
    // zeros(n) = mdot1*c1 + mdot2*c2 + mdot3*c3 // error
  end Mixing1;

  model Mixing2 "Mixing of multi-substance flows, alternative 2"
    replaceable type E=enumeration(:)"Substances in Fluid";
    input Real c1[E], c2[E], mdot1, mdot2;
    output Real c3[E], mdot3;
    protected
      // No efficiency loss, since cc1, cc2, cc3
      // may be removed during translation
      Real cc1[:]=c1, cc2[:]=c2, cc3[:]=c3;
      final parameter Integer n = size(cc1,1);
  equation
    0 = mdot1 + mdot2 + mdot3;
    zeros(n) = mdot1*cc1 + mdot2*cc2 + mdot3*cc3;
  end Mixing2;
end Types;

type enum = enumeration(a,b,c);

model X
   import Types.ResolveInFrameA;
   parameter ResolveInFrameA frame_r_in= ResolveInFrameA.frame_a;
   parameter Types.ResolveInFrameA frame_r_out=frame_r_in;
   Real x;
   enum f(quantity="quant_str_enumeration",min = enum.a,max = enum.b,fixed = true,start = enum.c);
   Types.EnumTest enumtest;
  equation
   x = if frame_r_out == frame_r_in then 0 else 1;
   f=enum.a;
end X;

// Result:
// Error processing file: Enum7.mo
// [<interactive>:16:69-16:80:writable] Error: Variable one not found in scope EnumTest.
// [<interactive>:17:22-17:48:writable] Error: Variable DigitalCurrent.one not found in scope EnumTest.
// Error: Error occurred while flattening model X
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
