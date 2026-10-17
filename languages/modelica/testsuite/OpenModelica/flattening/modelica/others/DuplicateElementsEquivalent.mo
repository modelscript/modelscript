// name:     DuplicateElementsEquivalent
// keywords: check if duplicate elements are the same even with when having named imports!
// status:   incorrect


package Crap
  type X = Real;
  type Y = Real;
end Crap;


model DuplicateElementsEquivalent
 import C=Crap;
 C.X x;
 Crap.X x;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end DuplicateElementsEquivalent;

// Result:
// Error processing file: DuplicateElementsEquivalent.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/others/DuplicateElementsEquivalent.mo:14:2-14:7:writable] Error: Duplicate elements:
//  .Crap.X x.
// Error: Error occurred while flattening model DuplicateElementsEquivalent
//
// Execution failed!
// endResult
