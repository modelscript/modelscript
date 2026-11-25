-- Structural Testbench for Pipelined 8-Bit ALU and Register File
library ieee;
use ieee.std_logic_1164.all;

entity tb_alu is
end entity tb_alu;

architecture sim of tb_alu is
  signal clk       : std_logic := '0';
  signal rst       : std_logic := '1';
  signal we        : std_logic := '0';
  signal rs1_addr  : std_logic_vector(1 downto 0) := "01";
  signal rs2_addr  : std_logic_vector(1 downto 0) := "10";
  signal rd_addr   : std_logic_vector(1 downto 0) := "11";
  signal alu_op    : std_logic_vector(2 downto 0) := "000";
  signal alu_out   : std_logic_vector(7 downto 0);
  signal zero_flag : std_logic;

  component alu_top is
    port (
      clk       : in  std_logic;
      rst       : in  std_logic;
      we        : in  std_logic;
      rs1_addr  : in  std_logic_vector(1 downto 0);
      rs2_addr  : in  std_logic_vector(1 downto 0);
      rd_addr   : in  std_logic_vector(1 downto 0);
      alu_op    : in  std_logic_vector(2 downto 0);
      alu_out   : out std_logic_vector(7 downto 0);
      zero_flag : out std_logic
    );
  end component alu_top;
begin
  u_dut : alu_top
    port map (
      clk       => clk,
      rst       => rst,
      we        => we,
      rs1_addr  => rs1_addr,
      rs2_addr  => rs2_addr,
      rd_addr   => rd_addr,
      alu_op    => alu_op,
      alu_out   => alu_out,
      zero_flag => zero_flag
    );
end architecture sim;
