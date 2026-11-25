// Testbench for Single-Cycle 16-Bit RISC Core
module tb_cpu;
  reg         clk;
  reg         rst;
  reg  [15:0] instr;
  wire [15:0] pc;
  wire [15:0] alu_result;
  wire        zero_flag;

  cpu_top u_cpu (
    .clk(clk),
    .rst(rst),
    .instr(instr),
    .pc(pc),
    .alu_result(alu_result),
    .zero_flag(zero_flag)
  );

  initial begin
    clk   = 1'b0;
    rst   = 1'b1;
    instr = 16'h1A80;
  end
endmodule
