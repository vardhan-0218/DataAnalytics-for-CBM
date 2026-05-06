import numpy as np
from datetime import datetime

"""Core motor degradation model.

This module is intentionally UI-agnostic so analytics and app layers can reuse
the same physics rules.

Model summary per cycle:
1) degradation = wear_rate * (t - t_prev)
2) sigma_noise = SIGMA_INIT + (k_noise * degradation)
3) motor_current = I_base + degradation + noise, where noise ~ N(0, sigma_noise)
"""

I_BASE_INIT      = 5.0    # initial motor current baseline (A)
SIGMA_INIT       = 0.1    # base noise std (A)
K_NOISE_INIT     = 0.25   # initial noise sensitivity
SEED             = 42

CT_BASE = 2.0
CT_K = 0.1


class MotorSimulator:
    """
    Holds the running state of the simulation.
    Call .step() once per cycle to advance time by 1.
    Call .interrupt(new_wear_rate) when slider changes.
    """

    def __init__(self):
        np.random.seed(SEED)
        self.reset()

    def reset(self):
        """Reset to initial state."""
        np.random.seed(SEED)
        self.t           = 0            # current time (auto-increments)
        self.wear_rate   = 0.0          # starts at 0
        self.I_base      = I_BASE_INIT  # current baseline
        self.t_prev      = 0            # reference time for degradation
        self.sigma_noise = SIGMA_INIT   # noise std
        self.k_noise     = K_NOISE_INIT # noise sensitivity
        self.history     = []           # all generated rows
        self.events      = []           # interrupt log
        self._last_motor_current = I_BASE_INIT  # track last applied motor current for UI
        self.last_cmd_wear_rate = 0.0   # last user-commanded wear rate (for reduction detection)
        self._manual_k_noise = K_NOISE_INIT

    def _current_degradation(self):
        """Return the current wear-driven degradation amount."""
        return self.wear_rate * (self.t - self.t_prev)

    def interrupt(self, new_wear_rate):
        """
                Apply an external wear-rate command at the current simulation time.

                Behavior:
                - Increased or unchanged wear rate: capture current operating point by
                    setting I_base to the most recent motor_current, then continue.
                - Reduced wear rate: treat as a restart scenario and reset to initial
                    baseline/noise settings.

                Returns:
                        "UPDATED" for increase/same, "RESET" for reduction.
        """
        t = self.t
        ts = datetime.now().isoformat(timespec="seconds")
        
        # Check if wear rate is being reduced compared to previous user command.
        # This stays correct even after internal wear_rate is reset to 0.0.
        if new_wear_rate < self.last_cmd_wear_rate:
            # Wear rate REDUCED → Reset to initial state
            self.I_base = I_BASE_INIT
            self.wear_rate = 0.0
            self.t_prev = t
            self.sigma_noise = SIGMA_INIT
            self.k_noise = K_NOISE_INIT
            self.last_cmd_wear_rate = 0.0
            self._manual_k_noise = K_NOISE_INIT
            
            # Log the reset event
            self.events.append({
                "timestamp":     ts,
                "time":          t,
                "new_wear_rate": round(new_wear_rate, 5),
                "I_base_noted":  round(self.I_base, 4),
                "action":        "RESET"
            })
            return "RESET"
        else:
            # Wear rate INCREASED or SAME → I_base = last motor_current value
            if self.history:
                self.I_base = self.history[-1]["motor_current"]   # motor_current at t
            
            self.t_prev      = t              # reset reference time to now
            self.wear_rate   = new_wear_rate  # accept new wear rate
            self.last_cmd_wear_rate = new_wear_rate
            
            # Log the event
            self.events.append({
                "timestamp":     ts,
                "time":          t,
                "new_wear_rate": round(new_wear_rate, 5),
                "I_base_noted":  round(self.I_base, 4),
            })
            return "UPDATED"

    def step(self):
        """
        Advance simulation by one cycle and emit a single observation row.

        The same degradation term is used twice by design:
        - Mean drift: raises motor current baseline over time.
        - Variance growth: increases sigma_noise via k_noise.
        This models motors that become both higher-current and noisier as they wear.
        """
        self.t += 1
        t = self.t
        ts = datetime.now().isoformat(timespec="seconds")

        degradation  = self._current_degradation()
        self.sigma_noise = SIGMA_INIT + (self.k_noise * degradation)
        noise        = np.random.normal(0, self.sigma_noise)
        motor_current = self.I_base + degradation + noise

        # Cycle time proxy increases with load above original nominal baseline.
        cycle_time = CT_BASE + CT_K * (motor_current - I_BASE_INIT)

        row = {
            "timestamp":     ts,
            "t":             t,
            "I_base":        round(self.I_base,     4),
            "wear_rate":     round(self.wear_rate,  5),
            "degradation":   round(degradation,     6),
            "k_noise":       round(self.k_noise,    4),
            # "sigma_noise":   round(self.sigma_noise, 6),
            "noise":         round(noise,           6),
            "motor_current": round(motor_current,   4),
            "cycle_time":    round(cycle_time,      4),
        }

        self.history.append(row)
        return row

    def set_motor_current(self, value):
        """
        Set motor current baseline.
        Only applies if value differs from last applied value.
        Persists until next explicit change or interrupt.
        """
        if value != self._last_motor_current:
            self.I_base = float(value)
            self._last_motor_current = float(value)

    def set_k_noise(self, value):
        """
        Set noise sensitivity factor.
        Only applies if value differs from last applied value.
        Persists until next explicit change.

        Note: this updates sigma_noise immediately for the current state so the
        next row reflects the new sensitivity without waiting for another command.
        """
        if value != self._manual_k_noise:
            self.k_noise = float(value)
            self._manual_k_noise = float(value)
            self.sigma_noise = SIGMA_INIT + (self.k_noise * self._current_degradation())
