// name:     Type1
// keywords: type
// status:   incorrect
//
// You cannot define your own types, only derive them from the builtings.
//

type Type1
  Real x;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Type1;
// Result:
// Error processing file: Type1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Error: In class .Type1, class specialization 'type' can only be derived from predefined types.
// Error: Error occurred while flattening model Type1
//
// Execution failed!
// endResult
