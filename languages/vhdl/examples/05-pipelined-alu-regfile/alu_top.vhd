-- Pipelined 8-Bit ALU and Register File Top-Level Datapath
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity alu_top is
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
end entity alu_top;

architecture rtl of alu_top is
  signal op_a      : std_logic_vector(7 downto 0);
  signal op_b      : std_logic_vector(7 downto 0);
  signal alu_comb  : std_logic_vector(7 downto 0);
  signal alu_reg   : std_logic_vector(7 downto 0);
  signal zero_reg  : std_logic;

  component regfile is
    port (
      clk      : in  std_logic;
      rst      : in  std_logic;
      we       : in  std_logic;
      rs1_addr : in  std_logic_vector(1 downto 0);
      rs2_addr : in  std_logic_vector(1 downto 0);
      rd_addr  : in  std_logic_vector(1 downto 0);
      wdata    : in  std_logic_vector(7 downto 0);
      rdata1   : out std_logic_vector(7 downto 0);
      rdata2   : out std_logic_vector(7 downto 0)
    );
  end component regfile;
begin
  u_rf : regfile
    port map (
      clk      => clk,
      rst      => rst,
      we       => we,
      rs1_addr => rs1_addr,
      rs2_addr => rs2_addr,
      rd_addr  => rd_addr,
      wdata    => alu_reg,
      rdata1   => op_a,
      rdata2   => op_b
    );

  p_alu_comb : process(op_a, op_b, alu_op)
  begin
    case alu_op is
      when "000" =>
        alu_comb <= std_logic_vector(unsigned(op_a) + unsigned(op_b));
      when "001" =>
        alu_comb <= std_logic_vector(unsigned(op_a) - unsigned(op_b));
      when "010" =>
        alu_comb <= op_a and op_b;
      when "011" =>
        alu_comb <= op_a or op_b;
      when "100" =>
        alu_comb <= op_a xor op_b;
      when others =>
        alu_comb <= op_a;
    end case;
  end process p_alu_comb;

  p_pipe : process(clk, rst)
  begin
    if rst = '1' then
      alu_reg  <= (others => '0');
      zero_reg <= '1';
    elsif rising_edge(clk) then
      alu_reg <= alu_comb;
      if alu_comb = X"00" then
        zero_reg <= '1';
      else
        zero_reg <= '0';
      end if;
    end if;
  end process p_pipe;

  alu_out   <= alu_reg;
  zero_flag <= zero_reg;
end architecture rtl;
