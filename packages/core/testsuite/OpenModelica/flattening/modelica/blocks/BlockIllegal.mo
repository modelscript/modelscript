// name: BlockIllegal
// keywords: block
// status: correct
//
// Tests block connections of non-directional components
// THIS TEST SHOULD FAIL
//

block TestBlock
  Integer i;
end TestBlock;

model BlockIllegal
  TestBlock tb1,tb2;
equation
  tb1.i = 1;
  connect(tb1.i,tb2.i);
end BlockIllegal;

// Result:
// Error processing file: BlockIllegal.mo
// [OpenModelica/flattening/modelica/blocks/BlockIllegal.mo:17:3-17:23:writable] Error: tb1.i is not a valid connector.
// Error: Error occurred while flattening model BlockIllegal
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
