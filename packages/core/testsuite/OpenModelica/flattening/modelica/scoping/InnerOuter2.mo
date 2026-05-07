// name:     InnerOuter2
// keywords: dynamic scope, lookup
// status:   correct
//
//  components with inner prefix references an outer component with
//  the same name and one variable is generated for all of them.
//
class A
  outer Real TI;
  class B
    Real TI;
    class C
      Real TI;
      class D
  outer Real TI; //
      end D;
      D d;
    end C;
    C c;
  end B;
  B b;
end A;
class E
  inner Real TI;
  class F
    inner Real TI;
    class G
      Real TI;
      class H
  A a;
      end H;
      H h;
    end G;
    G g;
  end F;
  F f;
end E;
class I
  inner Real TI;
  E e;
  // e.f.g.h.a.TI, e.f.g.h.a.b.c.d.TI, and e.f.TI is the same variable
  // But e.f.TI, e.TI and TI are different variables
  A a; // a.TI, a.b.c.d.TI, and TI is the same variable
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
