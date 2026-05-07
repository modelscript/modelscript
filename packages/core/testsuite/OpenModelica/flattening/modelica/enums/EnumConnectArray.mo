// name:     EnumConnectArray
// keywords: enum connect array
// status:   correct
//
// Tests that enumeration literals are preserved when connecting two arrays
// whose dimensions are given by enumerations.
//
type TComponents = enumeration (AA, BB, CC);

block TBlock
  input Real[TComponents] In;
  output Real[TComponents] Out;
end TBlock;

block EnumConnectArray
  TBlock Block1;
  TBlock Block2;
equation
  connect(Block2.In, Block1.Out);
end EnumConnectArray;

// Result:
// Error processing file: EnumConnectArray.mo
// [OpenModelica/flattening/modelica/enums/EnumConnectArray.mo:19:3-19:33:writable] Error: Block2.In is not a valid connector.
// Error: Error occurred while flattening model EnumConnectArray
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
