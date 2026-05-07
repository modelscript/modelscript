// name: InnerOuter13
// keywords:
// status: correct
//

model A
  model NestedA
    outer Real x;
  end NestedA;

  A.NestedA nestedA;
end A;

model InnerOuter13
  inner Real x = 1;
  A a;
end InnerOuter13;

// Result:
// Error processing file: InnerOuter13.mo
// [OpenModelica/flattening/modelica/scodeinst/InnerOuter13.mo:15:3-15:19:writable] Error: The model can't be instantiated due to top-level outer element 'x', it may only be used as part of a simulation model.
// Error: Error occurred while flattening model InnerOuter13
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
