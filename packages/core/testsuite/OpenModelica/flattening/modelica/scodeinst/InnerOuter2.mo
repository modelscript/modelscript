// name: InnerOuter2
// keywords:
// status: correct
//
// inner/outer example from the specification.
//

model A
  model B
    model C
      model D
        outer Real TI;
      end D;

      Real TI;
      D d;
    end C;

    Real TI;
    C c;
  end B;

  outer Real TI;
  B b;
end A;

model E
  model F
    model G
      model H
        A a;
      end H;

      Real TI;
      H h;
    end G;

    inner Real TI;
    G g;
  end F;

  inner Real TI;
  F f;
end E;

model I
  inner Real TI;
  E e;
  A a;
end I;

// Result:
// Error processing file: InnerOuter2.mo
// Error: Failed to load package InnerOuter2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class InnerOuter2 not found in scope <top>.
// Error: Error occurred while flattening model InnerOuter2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
