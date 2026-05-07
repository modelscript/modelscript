// name: ImportUnqualified4.mo
// status: correct

package A
  import A.Units.*;

  model AM
    parameter Pressure p = 0;
  end AM;

  package Units
    type Pressure = Real;
  end Units;
end A;

model ImportUnqualified4
  A.AM am;
end ImportUnqualified4;


// Result:
// Error processing file: ImportUnqualified4.mo
// Error: Class ImportUnqualified4.mo not found in scope <top>.
// Error: Error occurred while flattening model ImportUnqualified4.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
