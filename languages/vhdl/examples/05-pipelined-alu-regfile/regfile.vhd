-- 4x8-Bit Dual-Read Single-Write Register File
library ieee;
use ieee.std_logic_1164.all;

entity regfile is
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
end entity regfile;

architecture rtl of regfile is
  signal r0 : std_logic_vector(7 downto 0);
  signal r1 : std_logic_vector(7 downto 0);
  signal r2 : std_logic_vector(7 downto 0);
  signal r3 : std_logic_vector(7 downto 0);
begin
  p_write : process(clk, rst)
  begin
    if rst = '1' then
      r0 <= X"00";
      r1 <= X"01";
      r2 <= X"02";
      r3 <= X"03";
    elsif rising_edge(clk) then
      if we = '1' then
        case rd_addr is
          when "00" => r0 <= wdata;
          when "01" => r1 <= wdata;
          when "10" => r2 <= wdata;
          when others => r3 <= wdata;
        end case;
      end if;
    end if;
  end process p_write;

  with rs1_addr select
    rdata1 <= r0 when "00",
              r1 when "01",
              r2 when "10",
              r3 when others;

  with rs2_addr select
    rdata2 <= r0 when "00",
              r1 when "01",
              r2 when "10",
              r3 when others;
end architecture rtl;
