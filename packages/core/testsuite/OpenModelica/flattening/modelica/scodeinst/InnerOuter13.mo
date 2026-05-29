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
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/InnerOuter13.mo:15:3-15:19:writable] Error: The model can't be instantiated due to top-level outer element 'x', it may only be used as part of a simulation model.
//
// Execution failed!
// endResult
