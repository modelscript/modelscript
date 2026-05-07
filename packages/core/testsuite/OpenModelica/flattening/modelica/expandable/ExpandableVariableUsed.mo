//name:        ExpandableVariableUsed.mo [BUG: #2385]
//keyword:     expandable
//status:      correct
//
// instantiate/check model example
//

package ExpandablePack

  expandable connector B
    Real x;
  end B;

  block Bsource
    output B bout;
  equation
    bout.x = sin(time);
  end Bsource;

  model Areceiver
    input B bin;
    Real y;
  equation
    y = 2 * bin.x;
  end Areceiver;

  model Test
    Areceiver a1;
    Bsource b1;
  equation
    connect(b1.bout,a1.bin);
  end Test;
end ExpandablePack;

model ExpandableVariableUsed
  extends ExpandablePack.Test;
end ExpandableVariableUsed;

// Result:
// class InStreamArray
//   final parameter Integer N = 3;
//   parameter Integer M[1] = 10;
//   parameter Integer M[2] = 20;
//   parameter Integer M[3] = 30;
//   parameter Real fnom[1] = 1.0;
//   parameter Real fnom[2] = 2.0;
//   parameter Real fnom[3] = 3.0;
//   parameter Real c[1].fnom = fnom[1];
//   parameter Real c[1].M = /*Real*/(M[1]);
//   Real c[1].a.e;
//   Real c[1].a.f(nominal = c[1].fnom * c[1].M);
//   Real c[1].a.s;
//   Real c[1].b.e;
//   Real c[1].b.f(nominal = c[1].fnom * c[1].M);
//   Real c[1].b.s;
//   parameter Real c[1].t.fnom = c[1].fnom;
//   Real c[1].t.a.e;
//   Real c[1].t.a.f(nominal = c[1].t.fnom);
//   Real c[1].t.a.s;
//   Real c[1].t.b.e;
//   Real c[1].t.b.f(nominal = c[1].t.fnom);
//   Real c[1].t.b.s;
//   parameter Real c[1].v.fnom = c[1].fnom;
//   Real c[1].v.p.e;
//   Real c[1].v.p.f(nominal = c[1].v.fnom);
//   Real c[1].v.p.s;
//   parameter Real c[2].fnom = fnom[2];
//   parameter Real c[2].M = /*Real*/(M[2]);
//   Real c[2].a.e;
//   Real c[2].a.f(nominal = c[2].fnom * c[2].M);
//   Real c[2].a.s;
//   Real c[2].b.e;
//   Real c[2].b.f(nominal = c[2].fnom * c[2].M);
//   Real c[2].b.s;
//   parameter Real c[2].t.fnom = c[2].fnom;
//   Real c[2].t.a.e;
//   Real c[2].t.a.f(nominal = c[2].t.fnom);
//   Real c[2].t.a.s;
//   Real c[2].t.b.e;
//   Real c[2].t.b.f(nominal = c[2].t.fnom);
//   Real c[2].t.b.s;
//   parameter Real c[2].v.fnom = c[2].fnom;
//   Real c[2].v.p.e;
//   Real c[2].v.p.f(nominal = c[2].v.fnom);
//   Real c[2].v.p.s;
//   parameter Real c[3].fnom = fnom[3];
//   parameter Real c[3].M = /*Real*/(M[3]);
//   Real c[3].a.e;
//   Real c[3].a.f(nominal = c[3].fnom * c[3].M);
//   Real c[3].a.s;
//   Real c[3].b.e;
//   Real c[3].b.f(nominal = c[3].fnom * c[3].M);
//   Real c[3].b.s;
//   parameter Real c[3].t.fnom = c[3].fnom;
//   Real c[3].t.a.e;
//   Real c[3].t.a.f(nominal = c[3].t.fnom);
//   Real c[3].t.a.s;
//   Real c[3].t.b.e;
//   Real c[3].t.b.f(nominal = c[3].t.fnom);
//   Real c[3].t.b.s;
//   parameter Real c[3].v.fnom = c[3].fnom;
//   Real c[3].v.p.e;
//   Real c[3].v.p.f(nominal = c[3].v.fnom);
//   Real c[3].v.p.s;
// equation
//   c[1].a.e = c[1].t.a.e;
//   c[1].t.a.f - c[1].a.f = 0.0;
//   c[1].t.a.s = c[1].a.s;
//   c[1].b.e = c[1].v.p.e;
//   c[1].b.e = c[1].t.b.e;
//   c[1].b.s = $OMC$inStreamDiv(($OMC$PositiveMax(-c[1].t.b.f, 1e-7 * c[1].t.fnom) * c[1].t.b.s + $OMC$PositiveMax(-c[1].v.p.f, 1e-7 * c[1].v.fnom) * c[1].v.p.s) / ($OMC$PositiveMax(-c[1].t.b.f, 1e-7 * c[1].t.fnom) + $OMC$PositiveMax(-c[1].v.p.f, 1e-7 * c[1].v.fnom)), 0) " equation generated from stream connection";
//   c[2].a.e = c[2].t.a.e;
//   c[2].t.a.f - c[2].a.f = 0.0;
//   c[2].t.a.s = c[2].a.s;
//   c[2].b.e = c[2].v.p.e;
//   c[2].b.e = c[2].t.b.e;
//   c[2].b.s = $OMC$inStreamDiv(($OMC$PositiveMax(-c[2].t.b.f, 1e-7 * c[2].t.fnom) * c[2].t.b.s + $OMC$PositiveMax(-c[2].v.p.f, 1e-7 * c[2].v.fnom) * c[2].v.p.s) / ($OMC$PositiveMax(-c[2].t.b.f, 1e-7 * c[2].t.fnom) + $OMC$PositiveMax(-c[2].v.p.f, 1e-7 * c[2].v.fnom)), 0) " equation generated from stream connection";
//   c[3].a.e = c[3].t.a.e;
//   c[3].t.a.f - c[3].a.f = 0.0;
//   c[3].t.a.s = c[3].a.s;
//   c[3].b.e = c[3].v.p.e;
//   c[3].b.e = c[3].t.b.e;
//   c[3].b.s = $OMC$inStreamDiv(($OMC$PositiveMax(-c[3].t.b.f, 1e-7 * c[3].t.fnom) * c[3].t.b.s + $OMC$PositiveMax(-c[3].v.p.f, 1e-7 * c[3].v.fnom) * c[3].v.p.s) / ($OMC$PositiveMax(-c[3].t.b.f, 1e-7 * c[3].t.fnom) + $OMC$PositiveMax(-c[3].v.p.f, 1e-7 * c[3].v.fnom)), 0) " equation generated from stream connection";
//   c[1].b.e = c[2].a.e;
//   c[2].b.e = c[3].a.e;
//   c[1].a.f = 0.0;
//   c[2].a.f + c[1].b.f = 0.0;
//   c[1].v.p.f + c[1].t.b.f - c[1].b.f = 0.0;
//   c[3].a.f + c[2].b.f = 0.0;
//   c[2].v.p.f + c[2].t.b.f - c[2].b.f = 0.0;
//   c[3].b.f = 0.0;
//   c[3].v.p.f + c[3].t.b.f - c[3].b.f = 0.0;
//   c[1].t.a.f + c[1].t.b.f = 0.0;
//   c[1].t.a.f = c[1].t.a.e - c[1].t.b.e;
//   c[1].t.a.s = $OMC$inStreamDiv(($OMC$PositiveMax(c[1].b.f, 1e-7 * c[1].fnom * c[1].M) * c[2].a.s + $OMC$PositiveMax(-c[1].v.p.f, 1e-7 * c[1].v.fnom) * c[1].v.p.s) / ($OMC$PositiveMax(c[1].b.f, 1e-7 * c[1].fnom * c[1].M) + $OMC$PositiveMax(-c[1].v.p.f, 1e-7 * c[1].v.fnom)), c[1].t.b.s);
//   c[1].t.b.s = c[1].a.s;
//   c[1].v.p.e = 1.0;
//   c[1].v.p.s = 1.0;
//   c[2].t.a.f + c[2].t.b.f = 0.0;
//   c[2].t.a.f = c[2].t.a.e - c[2].t.b.e;
//   c[2].t.a.s = $OMC$inStreamDiv(($OMC$PositiveMax(c[2].b.f, 1e-7 * c[2].fnom * c[2].M) * c[3].a.s + $OMC$PositiveMax(-c[2].v.p.f, 1e-7 * c[2].v.fnom) * c[2].v.p.s) / ($OMC$PositiveMax(c[2].b.f, 1e-7 * c[2].fnom * c[2].M) + $OMC$PositiveMax(-c[2].v.p.f, 1e-7 * c[2].v.fnom)), c[2].t.b.s);
//   c[2].t.b.s = c[1].b.s;
//   c[2].v.p.e = 1.0;
//   c[2].v.p.s = 1.0;
//   c[3].t.a.f + c[3].t.b.f = 0.0;
//   c[3].t.a.f = c[3].t.a.e - c[3].t.b.e;
//   c[3].t.a.s = $OMC$inStreamDiv(($OMC$PositiveMax(c[3].b.f, 1e-7 * c[3].fnom * c[3].M) * c[3].b.s + $OMC$PositiveMax(-c[3].v.p.f, 1e-7 * c[3].v.fnom) * c[3].v.p.s) / ($OMC$PositiveMax(c[3].b.f, 1e-7 * c[3].fnom * c[3].M) + $OMC$PositiveMax(-c[3].v.p.f, 1e-7 * c[3].v.fnom)), c[3].t.b.s);
//   c[3].t.b.s = c[2].b.s;
//   c[3].v.p.e = 1.0;
//   c[3].v.p.s = 1.0;
// end InStreamArray;
// endResult
