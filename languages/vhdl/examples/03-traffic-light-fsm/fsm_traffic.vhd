-- Two-Process Moore FSM for Main/Side Street Traffic Light Controller
library ieee;
use ieee.std_logic_1164.all;

entity fsm_traffic is
  port (
    clk       : in  std_logic;
    rst       : in  std_logic;
    car_side  : in  std_logic;
    timer_exp : in  std_logic;
    main_led  : out std_logic_vector(2 downto 0);
    side_led  : out std_logic_vector(2 downto 0)
  );
end entity fsm_traffic;

architecture rtl of fsm_traffic is
  type state_t is (S_MAIN_GREEN, S_MAIN_YELLOW, S_SIDE_GREEN, S_SIDE_YELLOW);
  signal state      : state_t;
  signal next_state : state_t;
begin
  p_state_reg : process(clk, rst)
  begin
    if rst = '1' then
      state <= S_MAIN_GREEN;
    elsif rising_edge(clk) then
      state <= next_state;
    end if;
  end process p_state_reg;

  p_next_state : process(state, car_side, timer_exp)
  begin
    next_state <= state;
    main_led   <= "100";
    side_led   <= "100";
    case state is
      when S_MAIN_GREEN =>
        main_led <= "001";
        side_led <= "100";
        if car_side = '1' and timer_exp = '1' then
          next_state <= S_MAIN_YELLOW;
        end if;
      when S_MAIN_YELLOW =>
        main_led <= "010";
        side_led <= "100";
        if timer_exp = '1' then
          next_state <= S_SIDE_GREEN;
        end if;
      when S_SIDE_GREEN =>
        main_led <= "100";
        side_led <= "001";
        if timer_exp = '1' then
          next_state <= S_SIDE_YELLOW;
        end if;
      when S_SIDE_YELLOW =>
        main_led <= "100";
        side_led <= "010";
        if timer_exp = '1' then
          next_state <= S_MAIN_GREEN;
        end if;
    end case;
  end process p_next_state;
end architecture rtl;
