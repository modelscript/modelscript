// name:     ImportSelf1
// keywords: import, bug1445
// status:   correct
//
// Checks that importing a package in itself works.
//

package ImportSelf1
  import P = ImportSelf1;

  function f
    output Real r = 2.0;
  end f;

  constant Real c = P.f();
end ImportSelf1;

// Result:
// Error processing file: ImportSelf1.mo
// [OpenModelica/flattening/modelica/packages/ImportSelf1.mo:8:1-17:16:writable] Error: Cannot instantiate ImportSelf1 due to class specialization package.
// Error: Error occurred while flattening model ImportSelf1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
