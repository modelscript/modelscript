% Longitudinal Aircraft Pitch Autopilot Gain Initialization
% Cruise condition: Mach 0.78, Altitude 10,000 m
Kp_theta = 4.5;     % Outer-loop pitch attitude gain [rad/rad]
Kq_damper = 1.2;    % Inner-loop pitch rate damper gain [s]
M_de = 3.8;         % Elevator control effectiveness [1/s^2]
theta_cmd = 0.10;   % Commanded pitch step [rad] (~5.7 deg)
