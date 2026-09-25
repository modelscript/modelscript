// SPDX-License-Identifier: AGPL-3.0-or-later

package FormalAlgorithms

  function safeFilter
    input Real[5] x;
    output Real y;
    protected
      Integer i;
  algorithm
    y := 0.0;
    for i in 1:5 loop
      y := y + x[i] * 0.2;
    end for;
  end safeFilter;

  function safeDivider
    input Real val;
    output Real outVal;
    protected
      Real denom;
  algorithm
    denom := 2.0;
    outVal := val / denom;
  end safeDivider;

end FormalAlgorithms;
