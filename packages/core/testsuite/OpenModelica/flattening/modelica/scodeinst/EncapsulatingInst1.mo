// name: EncapsulatingInst1
// keywords:
// status: correct
// cflags: -i=EncapsulatingInst1.M
//

model EncapsulatingInst1
  model M
    EncapsulatingInst1 x(i = 1);
  end M;

  constant Integer i;
end EncapsulatingInst1;

// Result:
// Error processing file: EncapsulatingInst1.mo
// [OpenModelica/flattening/modelica/scodeinst/EncapsulatingInst1.mo:12:3-12:21:writable] Error: Constant 'i' has no value.
// Error: Error occurred while flattening model EncapsulatingInst1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
