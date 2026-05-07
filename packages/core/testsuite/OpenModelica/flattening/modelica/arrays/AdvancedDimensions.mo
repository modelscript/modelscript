// name:     AdvancedDimensions.mo
// keywords: array
// status:   correct
//
// make sure we handle weird dimensions in functions/models/arrays
//

package Models

  package Test
    model Ground
      parameter Boolean show_trace = false;
      parameter Integer samples = 25;
      parameter Real[:, 2] road = [-10, 0.0; 10.0, 0.0];
      parameter Real crr = 0.01;
    protected
      parameter Real[:, 2] p = C2M2L_Component_Building_Blocks.Suspension.Contact_Models.roll_through(road, wheel_rad, samples) if show_trace;
    end Ground;

    model Flat_Road
      extends Ground(road = [-20.0, 0.0; 20.0, 0.0]);
    end Flat_Road;
  end Test;

  package Test2
    model M1
    protected
      outer Models.Test.Ground ground_context;
      parameter Real radius = 1;
      parameter Integer size_p = size(p, 1);
      parameter Real[:, 2] p = roll_through(ground_context.road, radius, ground_context.samples);
      parameter Real[size_p - 1] p_length = array(sqrt((p[i, 1] - p[i + 1, 1]) ^ 2 + (p[i, 2] - p[i + 1, 2]) ^ 2) for i in 1:size(p, 1) - 1);
    end M1;

    function roll_through
      input Real[:, 2] road_dat;
      input Real rad;
      input Integer samples;
      output Real[(if samples > 0 then samples else size(road_dat, 1)) + 2, 2] center_pos;
    algorithm
      center_pos := fill(0, size(center_pos,1), size(center_pos, 2));
    end roll_through;

    model R
       M1 m1;
    end R;

    model D
      inner Models.Test.Flat_Road ground_context;
      R r;
    end D;
  end Test2;
end Models;

model AdvancedDimensions
  extends Models.Test2.D;
end AdvancedDimensions;


// Result:
// Error processing file: AdvancedDimensions.mo
// [OpenModelica/flattening/modelica/arrays/AdvancedDimensions.mo:17:7-17:142:writable] Error: Variable wheel_rad not found in scope Ground.
// Error: Class AdvancedDimensions.mo not found in scope <top>.
// Error: Error occurred while flattening model AdvancedDimensions.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
