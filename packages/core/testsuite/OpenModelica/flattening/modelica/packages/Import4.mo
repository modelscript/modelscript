// name:     Import4
// keywords: import
// status:   correct
//
// Import in enclosing scopes is valid.

package A
  package B
    partial model C
      Real x;
    end C;
    model D
      extends C(x=5);
    end D;
  end B;
  package B1
    model C
      extends B.C(x=4);
    end C;
  end B1;
  package B2
    model C
      extends B.C(x=7);
    end C;
    model E=B.C(x=6);
  end B2;
end A;

package B
  import A.B.*;
  import A.B2.*;
  import A.B1.C;
  import MyC=A.B2.C;
  package A
  model C=MyC(x=1);
  model F
    C c;
    D d;
    E e;
    MyC myc;
  end F;
  end A;
end B;

model Import4
  extends B.A.F;
end Import4;

// Result:
// Error processing file: Import4.mo
// [OpenModelica/flattening/modelica/packages/Import4.mo:25:5-25:21:writable] Notification: From here:
// [OpenModelica/flattening/modelica/packages/Import4.mo:39:5-39:8:writable] Error: Component 'e' has partial type 'E'.
// Error: Error occurred while flattening model Import4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
