// Single-Cycle 16-Bit RISC Core Top-Level Module
module cpu_top (
  input         clk,
  input         rst,
  input  [15:0] instr,
  output reg [15:0] pc,
  output wire [15:0] alu_result,
  output wire   zero_flag
);
  wire [2:0]  opcode;
  wire [1:0]  rd;
  wire [1:0]  rs1;
  wire [1:0]  rs2;
  wire        reg_we;
  wire [15:0] rdata1;
  wire [15:0] rdata2;

  assign opcode = instr[15:13];
  assign rd     = instr[12:11];
  assign rs1    = instr[10:9];
  assign rs2    = instr[8:7];
  assign reg_we = (opcode != 3'b111);

  regfile16 u_rf (
    .clk(clk),
    .rst(rst),
    .we(reg_we),
    .rs1(rs1),
    .rs2(rs2),
    .rd(rd),
    .wdata(alu_result),
    .rdata1(rdata1),
    .rdata2(rdata2)
  );

  alu16 u_alu (
    .a(rdata1),
    .b(rdata2),
    .op(opcode),
    .y(alu_result),
    .zero(zero_flag)
  );

  always @(posedge clk) begin
    if (rst)
      pc <= 16'h0000;
    else
      pc <= pc + 16'h0002;
  end
endmodule
