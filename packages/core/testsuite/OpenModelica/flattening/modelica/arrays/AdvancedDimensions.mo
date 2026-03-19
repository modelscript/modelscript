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
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end AdvancedDimensions;


// Result:
// function Models.Test2.roll_through
//   input Real[:, 2] road_dat;
//   input Real rad;
//   input Integer samples;
//   output Real[2 + if samples > 0 then samples else size(road_dat, 1), 2] center_pos;
// algorithm
//   center_pos := fill(0.0, size(center_pos, 1), size(center_pos, 2));
// end Models.Test2.roll_through;
// 
// class AdvancedDimensions
//   parameter Boolean ground_context.show_trace = false;
//   parameter Integer ground_context.samples = 25;
//   parameter Real ground_context.road[1,1] = -20.0;
//   parameter Real ground_context.road[1,2] = 0.0;
//   parameter Real ground_context.road[2,1] = 20.0;
//   parameter Real ground_context.road[2,2] = 0.0;
//   parameter Real ground_context.crr = 0.01;
//   protected parameter Real r.m1.radius = 1.0;
//   protected parameter Integer r.m1.size_p = size(r.m1.p, 1);
//   protected parameter Real r.m1.p[1,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[1,1];
//   protected parameter Real r.m1.p[1,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[1,2];
//   protected parameter Real r.m1.p[2,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[2,1];
//   protected parameter Real r.m1.p[2,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[2,2];
//   protected parameter Real r.m1.p[3,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[3,1];
//   protected parameter Real r.m1.p[3,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[3,2];
//   protected parameter Real r.m1.p[4,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[4,1];
//   protected parameter Real r.m1.p[4,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[4,2];
//   protected parameter Real r.m1.p[5,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[5,1];
//   protected parameter Real r.m1.p[5,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[5,2];
//   protected parameter Real r.m1.p[6,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[6,1];
//   protected parameter Real r.m1.p[6,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[6,2];
//   protected parameter Real r.m1.p[7,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[7,1];
//   protected parameter Real r.m1.p[7,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[7,2];
//   protected parameter Real r.m1.p[8,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[8,1];
//   protected parameter Real r.m1.p[8,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[8,2];
//   protected parameter Real r.m1.p[9,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[9,1];
//   protected parameter Real r.m1.p[9,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[9,2];
//   protected parameter Real r.m1.p[10,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[10,1];
//   protected parameter Real r.m1.p[10,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[10,2];
//   protected parameter Real r.m1.p[11,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[11,1];
//   protected parameter Real r.m1.p[11,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[11,2];
//   protected parameter Real r.m1.p[12,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[12,1];
//   protected parameter Real r.m1.p[12,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[12,2];
//   protected parameter Real r.m1.p[13,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[13,1];
//   protected parameter Real r.m1.p[13,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[13,2];
//   protected parameter Real r.m1.p[14,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[14,1];
//   protected parameter Real r.m1.p[14,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[14,2];
//   protected parameter Real r.m1.p[15,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[15,1];
//   protected parameter Real r.m1.p[15,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[15,2];
//   protected parameter Real r.m1.p[16,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[16,1];
//   protected parameter Real r.m1.p[16,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[16,2];
//   protected parameter Real r.m1.p[17,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[17,1];
//   protected parameter Real r.m1.p[17,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[17,2];
//   protected parameter Real r.m1.p[18,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[18,1];
//   protected parameter Real r.m1.p[18,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[18,2];
//   protected parameter Real r.m1.p[19,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[19,1];
//   protected parameter Real r.m1.p[19,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[19,2];
//   protected parameter Real r.m1.p[20,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[20,1];
//   protected parameter Real r.m1.p[20,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[20,2];
//   protected parameter Real r.m1.p[21,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[21,1];
//   protected parameter Real r.m1.p[21,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[21,2];
//   protected parameter Real r.m1.p[22,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[22,1];
//   protected parameter Real r.m1.p[22,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[22,2];
//   protected parameter Real r.m1.p[23,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[23,1];
//   protected parameter Real r.m1.p[23,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[23,2];
//   protected parameter Real r.m1.p[24,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[24,1];
//   protected parameter Real r.m1.p[24,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[24,2];
//   protected parameter Real r.m1.p[25,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[25,1];
//   protected parameter Real r.m1.p[25,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[25,2];
//   protected parameter Real r.m1.p[26,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[26,1];
//   protected parameter Real r.m1.p[26,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[26,2];
//   protected parameter Real r.m1.p[27,1] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[27,1];
//   protected parameter Real r.m1.p[27,2] = Models.Test2.roll_through({{ground_context.road[1,1], ground_context.road[1,2]}, {ground_context.road[2,1], ground_context.road[2,2]}}, r.m1.radius, ground_context.samples)[27,2];
//   protected parameter Real r.m1.p_length[1] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[1];
//   protected parameter Real r.m1.p_length[2] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[2];
//   protected parameter Real r.m1.p_length[3] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[3];
//   protected parameter Real r.m1.p_length[4] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[4];
//   protected parameter Real r.m1.p_length[5] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[5];
//   protected parameter Real r.m1.p_length[6] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[6];
//   protected parameter Real r.m1.p_length[7] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[7];
//   protected parameter Real r.m1.p_length[8] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[8];
//   protected parameter Real r.m1.p_length[9] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[9];
//   protected parameter Real r.m1.p_length[10] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[10];
//   protected parameter Real r.m1.p_length[11] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[11];
//   protected parameter Real r.m1.p_length[12] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[12];
//   protected parameter Real r.m1.p_length[13] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[13];
//   protected parameter Real r.m1.p_length[14] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[14];
//   protected parameter Real r.m1.p_length[15] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[15];
//   protected parameter Real r.m1.p_length[16] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[16];
//   protected parameter Real r.m1.p_length[17] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[17];
//   protected parameter Real r.m1.p_length[18] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[18];
//   protected parameter Real r.m1.p_length[19] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[19];
//   protected parameter Real r.m1.p_length[20] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[20];
//   protected parameter Real r.m1.p_length[21] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[21];
//   protected parameter Real r.m1.p_length[22] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[22];
//   protected parameter Real r.m1.p_length[23] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[23];
//   protected parameter Real r.m1.p_length[24] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[24];
//   protected parameter Real r.m1.p_length[25] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[25];
//   protected parameter Real r.m1.p_length[26] = array(sqrt((r.m1.p[i,1] - r.m1.p[1 + i,1]) ^ 2.0 + (r.m1.p[i,2] - r.m1.p[1 + i,2]) ^ 2.0) for i in 1:26)[26];
// end AdvancedDimensions;
// endResult

