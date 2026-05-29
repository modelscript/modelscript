// name: Prefix3
// keywords:
// status: correct
// cflags: -i=P.P2.Prefix3
//

package P
  package P2
    model Prefix3
      function f
        input Real x;
        output Real y;
      algorithm
        y := x;
      end f;

      Real x = f(time);
    end Prefix3;
  end P2;
  annotation(__OpenModelica_commandLineOptions="-i=P.P2.Prefix3");
end P;

// Result:
// Error processing file: Prefix3.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/Prefix3.mo:7:1-21:6:writable] Error: Cannot instantiate P due to class specialization package.
//
// Execution failed!
// endResult
