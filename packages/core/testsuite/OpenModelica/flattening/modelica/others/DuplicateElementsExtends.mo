// name:     DuplicateElementsExtends
// keywords: check if duplicate elements one from extends are equivalent!
// status:   incorrect


package Crap
  type X = Real;
  type Y = Real;
end Crap;

model Duplicate
 Crap.Y x;
end Duplicate;

model DuplicateElementsExtends
 extends Duplicate; // have another x
 import C=Crap;
 C.X x;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end DuplicateElementsExtends;

// Result:
// Error processing file: DuplicateElementsExtends.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/others/DuplicateElementsExtends.mo:18:2-18:7:writable] Notification: From here:
// [OpenModelica/flattening/modelica/others/DuplicateElementsExtends.mo:12:2-12:10:writable] Error: Duplicate elements (due to inherited elements) not identical:
//   first element is:  .Crap.X x
//   second element is: .Crap.Y x
// Error: Error occurred while flattening model DuplicateElementsExtends
//
// Execution failed!
// endResult
