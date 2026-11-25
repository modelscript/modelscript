-- Parameterized Synchronous Up/Down Counter with Terminal Count Flag
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity sync_updown_counter is
  generic (
    WIDTH : integer := 8
  );
  port (
    clk   : in  std_logic;
    rst   : in  std_logic;
    en    : in  std_logic;
    up    : in  std_logic;
    count : out std_logic_vector(7 downto 0);
    tc    : out std_logic
  );
end entity sync_updown_counter;

architecture rtl of sync_updown_counter is
  signal cnt_reg : std_logic_vector(7 downto 0);
  signal tc_reg  : std_logic;
begin
  p_cnt : process(clk, rst)
  begin
    if rst = '1' then
      cnt_reg <= (others => '0');
      tc_reg  <= '0';
    elsif rising_edge(clk) then
      if en = '1' then
        if up = '1' then
          if cnt_reg = X"FF" then
            cnt_reg <= X"00";
            tc_reg  <= '1';
          else
            cnt_reg <= std_logic_vector(unsigned(cnt_reg) + 1);
            tc_reg  <= '0';
          end if;
        else
          if cnt_reg = X"00" then
            cnt_reg <= X"FF";
            tc_reg  <= '1';
          else
            cnt_reg <= std_logic_vector(unsigned(cnt_reg) - 1);
            tc_reg  <= '0';
          end if;
        end if;
      else
        tc_reg <= '0';
      end if;
    end if;
  end process p_cnt;

  count <= cnt_reg;
  tc    <= tc_reg;
end architecture rtl;
