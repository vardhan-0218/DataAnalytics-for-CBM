

from __future__ import annotations

import argparse
import logging
import os
import select
import signal
import sys
import time
from pathlib import Path
from typing import Optional

import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

# ── psycopg import ────────────────────────────────────────────────────────────
try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:
    sys.exit(
        "psycopg is not installed.\n"
        "Run:  pip install 'psycopg[binary]'"
    )

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("analysis")


# =============================================================================
# 1.  DATABASE URL
# =============================================================================

def _resolve_db_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        return url
    env_path = Path(__file__).with_name(".env")
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            if k.strip() == "DATABASE_URL":
                return v.strip().strip('"').strip("'")
    return ""


DATABASE_URL = _resolve_db_url()
if not DATABASE_URL:
    sys.exit(
        "DATABASE_URL is not set.\n"
        "Export it in your shell:\n"
        "  export DATABASE_URL='postgresql://user:password@localhost:5432/motordb'\n"
        "or add it to a .env file in this folder."
    )


# =============================================================================
# 2.  CONFIG
# =============================================================================

class Config:
    """
    All tunable parameters for the EWMA alert pipeline.

    MU / SIGMA reflect the healthy-state motor current produced by the
    simulator (I_BASE_INIT = 5.0 A, SIGMA_INIT = 0.1 A at zero wear).
    Adjust if your run used different baseline settings.
    """
    def __init__(
        self,
        MU: float = 5.0,
        SIGMA: float = 0.25,
        S_EARLY: float = 0.005,
        S_MID: float = 0.01,
        S_LATE: float = 0.02,
        VAR_STABLE: float = 0.05,
        CT_BASELINE: float = 2.0,
        CT_EARLY_PCT: float = 0.03,
        CT_LATE_PCT: float = 0.05,
        I_THRESHOLD: float = 10.0,
        alpha: float = 0.1,
        alpha_fast: float | None = None,
        alpha_slow: float | None = None,
        g_early: float | None = None,
        g_mid: float | None = None,
        g_late: float | None = None,
        # How many recent rows to fetch per poll cycle
        fetch_limit: int = 200,
    ):
        self.MU = MU
        self.SIGMA = SIGMA
        self.UCL_2SIGMA = MU + 2 * SIGMA
        self.UCL_3SIGMA = MU + 3 * SIGMA

        self._S_EARLY = S_EARLY
        self._S_MID = S_MID
        self._S_LATE = S_LATE
        self.VAR_STABLE = VAR_STABLE

        self.CT_BASELINE = CT_BASELINE
        self.CT_EARLY_THRESHOLD = CT_BASELINE * (1 + CT_EARLY_PCT)
        self.CT_LATE_THRESHOLD = CT_BASELINE * (1 + CT_LATE_PCT)

        self.I_THRESHOLD = I_THRESHOLD
        self._alpha = alpha
        self.alpha_slow = alpha_slow if alpha_slow is not None else alpha
        self.alpha_fast = alpha_fast if alpha_fast is not None else min(1.0, max(0.01, self.alpha_slow * 6.0))

        self.alpha = alpha

        self.g_early = g_early if g_early is not None else self._S_EARLY * 10.0
        self.g_mid = g_mid if g_mid is not None else self._S_MID * 10.0
        self.g_late = g_late if g_late is not None else self._S_LATE * 10.0

        self.fetch_limit = fetch_limit

    @property
    def alpha(self) -> float:
        return self._alpha

    @alpha.setter
    def alpha(self, value: float) -> None:
        self._alpha = value
        # Keep dual-EWMA relationship when alpha is updated via API.
        self.alpha_slow = value
        self.alpha_fast = min(1.0, max(0.01, value * 6.0))

    @property
    def S_EARLY(self) -> float:
        return self._S_EARLY

    @S_EARLY.setter
    def S_EARLY(self, value: float) -> None:
        self._S_EARLY = value
        self.g_early = value * 10.0

    @property
    def S_MID(self) -> float:
        return self._S_MID

    @S_MID.setter
    def S_MID(self, value: float) -> None:
        self._S_MID = value
        self.g_mid = value * 10.0

    @property
    def S_LATE(self) -> float:
        return self._S_LATE

    @S_LATE.setter
    def S_LATE(self, value: float) -> None:
        self._S_LATE = value
        self.g_late = value * 10.0


# =============================================================================
# 3.  CONNECTION WRAPPER  (auto-reconnect on failure)
# =============================================================================

class DBConnection:
    """
    Wraps a single psycopg connection with automatic reconnect on failure.

    For production scale-out, replace with psycopg_pool.ConnectionPool:
        from psycopg_pool import ConnectionPool
        pool = ConnectionPool(DATABASE_URL)
    """

    def __init__(self, db_url: str):
        self._url = db_url
        self._conn: Optional[psycopg.Connection] = None

    def _connect(self) -> psycopg.Connection:
        conn = psycopg.connect(self._url, row_factory=dict_row)
        conn.autocommit = True
        log.info("Connected to database.")
        return conn

    def conn(self) -> psycopg.Connection:
        if self._conn is None or self._conn.closed:
            self._conn = self._connect()
        return self._conn

    def execute(self, sql: str, params=None):
        """Execute with automatic reconnect on transient failures."""
        try:
            return self.conn().execute(sql, params)
        except psycopg.OperationalError:
            log.warning("Connection lost — reconnecting…")
            self._conn = None
            return self.conn().execute(sql, params)

    def close(self) -> None:
        if self._conn and not self._conn.closed:
            self._conn.close()


# =============================================================================
# 4.  DATABASE HELPERS
# =============================================================================

def resolve_run_id(db: DBConnection, run_id: Optional[int]) -> tuple[int, dict]:
    """
    Returns (run_id, run_meta).
    If run_id is None, picks the run with the highest run_id that has
    at least one reading row (active or closed).
    """
    if run_id is None:
        row = db.execute(
            """
            SELECT r.run_id, r.run_name, r.started_at, r.ended_at
            FROM simulation_runs r
            WHERE EXISTS (
                SELECT 1 FROM simulation_readings sr WHERE sr.run_id = r.run_id
            )
            ORDER BY r.run_id DESC
            LIMIT 1
            """
        ).fetchone()
        if row is None:
            sys.exit(
                "No runs with readings found in the database.\n"
                "Start the Streamlit simulator first "
                "(python3 -m streamlit run app.py)."
            )
    else:
        row = db.execute(
            "SELECT run_id, run_name, started_at, ended_at "
            "FROM simulation_runs WHERE run_id = %s",
            (run_id,),
        ).fetchone()
        if row is None:
            sys.exit(f"run_id={run_id} not found in the database.")

    meta = dict(row)
    return meta["run_id"], meta


def fetch_new_rows(
    db: DBConnection,
    run_id: int,
    after_sim_t: int,
    limit: int = 200,
) -> list[dict]:
    """
    Fetch up to `limit` reading rows with sim_t > after_sim_t for this run,
    ordered by sim_t ascending so EWMA is applied in correct time order.

    Limiting reads to the latest N rows (instead of SELECT *) keeps queries
    fast as the table grows — a key performance tip from the feedback.
    """
    rows = db.execute(
        """
        SELECT sim_t, motor_current, cycle_time,
               i_base, wear_rate, degradation, k_noise, noise,
               recorded_at
        FROM simulation_readings
        WHERE run_id = %s
          AND sim_t > %s
        ORDER BY sim_t ASC
        LIMIT %s
        """,
        (run_id, after_sim_t, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def fetch_new_events(
    db: DBConnection,
    run_id: int,
    after_sim_t: int,
) -> list[dict]:
    """Fetch interrupt events we have not yet seen."""
    rows = db.execute(
        """
        SELECT sim_t, new_wear_rate, i_base_noted, action, recorded_at
        FROM simulation_interrupt_events
        WHERE run_id = %s
          AND sim_t > %s
        ORDER BY sim_t ASC
        """,
        (run_id, after_sim_t),
    ).fetchall()
    return [dict(r) for r in rows]


def is_run_active(db: DBConnection, run_id: int) -> bool:
    """Returns True if the run has not been closed (ended_at IS NULL)."""
    row = db.execute(
        "SELECT ended_at FROM simulation_runs WHERE run_id = %s",
        (run_id,),
    ).fetchone()
    return row is not None and row["ended_at"] is None


def setup_listen_notify(db_url: str) -> Optional[psycopg.Connection]:
    """
    Open a dedicated connection and LISTEN on 'new_data'.

    This implements the LISTEN/NOTIFY pattern recommended in the feedback:
    instead of sleeping a fixed interval, select() on this connection wakes
    up immediately when the generator calls NOTIFY new_data — giving true
    event-driven behaviour with zero extra latency.

    If NOTIFY is not set up on the writer side, the script falls back to
    time-based polling transparently.
    """
    try:
        conn = psycopg.connect(db_url)
        conn.autocommit = True
        conn.execute("LISTEN new_data")
        log.info("LISTEN/NOTIFY active on channel 'new_data'.")
        return conn
    except Exception as exc:
        log.warning(f"LISTEN setup skipped ({exc}) — using time-based polling.")
        return None


# =============================================================================
# 5.  ALERT SYSTEM
# =============================================================================

class AlertSystem:
    """
    Stateful dual-EWMA processor. Call .process(t, current) once per reading
    in ascending sim_t order. State persists across poll cycles so the
    EWMA is fully continuous even when new rows arrive in small batches.

    The dual-EWMA pipeline tracks both a slow baseline and a fast trend line:
      - slow EWMA = baseline position
      - fast EWMA = responsive trend signal
      - gap = fast - slow

    Tier    Trigger condition (all must hold simultaneously)
    ------  ---------------------------------------------------
    EARLY   slow EWMA below UCL_2σ  AND gap > g_early  AND variance stable
    MID     slow EWMA above UCL_2σ  AND gap > g_mid    AND cycle_time elevated
    LATE    slow EWMA above UCL_3σ  AND gap > g_late   AND cycle_time high
    """

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._fast = cfg.MU
        self._slow = cfg.MU
        self.ewma_prev = cfg.MU
        self.ewma_history: list[float] = []
        self.variance_window: list[float] = []
        self.variance_window_size = 50
        self.alerts: dict[str, list] = {
            "early": [],
            "mid": [],
            "late": [],
        }
        # Prevent duplicate console logs for the same tier
        self._logged: dict[str, bool] = {
            "early": False, "mid": False, "late": False
        }
        # Track current alert states for API
        self.alert_states: dict[str, any] = {
            "early": False,
            "mid": False,
            "late": False,
            "early_trigger_time": None,
            "mid_trigger_time": None,
            "late_trigger_time": None,
        }

    def process(self, t: int, current: float, return_dict: bool = False):
        """
        Advance one cycle using a dual-EWMA trend detector.
        
        Args:
            t: Simulation time step
            current: Current motor current reading
            return_dict: If True, returns dict with full analysis; if False, returns just EWMA value
            
        Returns:
            float (slow EWMA baseline) if return_dict=False,
            or dict with full analysis if return_dict=True
        """
        cfg = self.cfg

        # Dual EWMA update
        self._fast = cfg.alpha_fast * current + (1 - cfg.alpha_fast) * self._fast
        self._slow = cfg.alpha_slow * current + (1 - cfg.alpha_slow) * self._slow
        ewma = self._slow
        self.ewma_prev = ewma
        self.ewma_history.append(ewma)

        # Rolling variance (50-sample window)
        self.variance_window.append(current)
        if len(self.variance_window) > self.variance_window_size:
            self.variance_window.pop(0)
        rolling_var = (
            float(np.var(self.variance_window))
            if len(self.variance_window) > 10
            else 0.0
        )

        # Trend gap between fast and slow EWMA
        gap = self._fast - self._slow

        # EWMA slope over last 10 slow points for compatibility outputs
        k = 10
        slope = (
            (ewma - self.ewma_history[-k]) / k
            if len(self.ewma_history) > k
            else 0.0
        )

        # Cycle-time proxy based on slow EWMA baseline
        cycle_time = cfg.CT_BASELINE + 0.2 * (ewma - cfg.MU)

        # Time-to-failure projection
        t_fail = (
            (cfg.I_THRESHOLD - ewma) / slope
            if slope > 0
            else float("inf")
        )
        t_fail_api = 999999.0 if t_fail == float("inf") else t_fail

        # Alert tiers - dual-EWMA decision logic
        early_active = (
            ewma < cfg.UCL_2SIGMA
            and gap > cfg.g_early
            and rolling_var < cfg.VAR_STABLE
        )
        mid_active = (
            ewma > cfg.UCL_2SIGMA
            and gap > cfg.g_mid
            and cycle_time > cfg.CT_EARLY_THRESHOLD
        )
        late_active = (
            ewma > cfg.UCL_3SIGMA
            and gap > cfg.g_late
            and cycle_time > cfg.CT_LATE_THRESHOLD
        )

        # Track first triggers for alerts - ONLY append once per trigger
        if early_active:
            if not self.alert_states["early"]:
                # First time this alert becomes active
                if not self._logged["early"]:
                    log.warning(
                        f"[EARLY ALERT] t={t}  EWMA={ewma:.3f} A  "
                        f"gap={gap:.5f}  T_fail={t_fail:.0f} cycles"
                    )
                    self._logged["early"] = True
                
                # Only set trigger time and append if this is truly the first trigger
                if self.alert_states["early_trigger_time"] is None:
                    self.alert_states["early_trigger_time"] = t
                    log.info(f"[ALERT HISTORY] Adding EARLY alert at t={t} (first trigger)")
                    if return_dict:
                        from datetime import datetime
                        self.alerts["early"].append({"t": t, "ewma": round(ewma, 4), "timestamp": datetime.now().isoformat(timespec="seconds")})
                    else:
                        self.alerts["early"].append(t)
                else:
                    log.debug(f"[ALERT HISTORY] Skipping EARLY alert at t={t} (already triggered at t={self.alert_states['early_trigger_time']})")

        if mid_active:
            if not self.alert_states["mid"]:
                # First time this alert becomes active
                if not self._logged["mid"]:
                    log.warning(
                        f"[MID ALERT]   t={t}  EWMA={ewma:.3f} A  "
                        f"gap={gap:.5f}  T_fail={t_fail:.0f} cycles"
                    )
                    self._logged["mid"] = True
                
                # Only set trigger time and append if this is truly the first trigger
                if self.alert_states["mid_trigger_time"] is None:
                    self.alert_states["mid_trigger_time"] = t
                    log.info(f"[ALERT HISTORY] Adding MID alert at t={t} (first trigger)")
                    if return_dict:
                        from datetime import datetime
                        self.alerts["mid"].append({"t": t, "ewma": round(ewma, 4), "timestamp": datetime.now().isoformat(timespec="seconds")})
                    else:
                        self.alerts["mid"].append(t)
                else:
                    log.debug(f"[ALERT HISTORY] Skipping MID alert at t={t} (already triggered at t={self.alert_states['mid_trigger_time']})")

        if late_active:
            if not self.alert_states["late"]:
                # First time this alert becomes active
                if not self._logged["late"]:
                    log.warning(
                        f"[LATE ALERT]  t={t}  EWMA={ewma:.3f} A  "
                        f"gap={gap:.5f}  T_fail={t_fail:.0f} cycles"
                    )
                    self._logged["late"] = True
                
                # Only set trigger time and append if this is truly the first trigger
                if self.alert_states["late_trigger_time"] is None:
                    self.alert_states["late_trigger_time"] = t
                    log.info(f"[ALERT HISTORY] Adding LATE alert at t={t} (first trigger)")
                    if return_dict:
                        from datetime import datetime
                        self.alerts["late"].append({"t": t, "ewma": round(ewma, 4), "timestamp": datetime.now().isoformat(timespec="seconds")})
                    else:
                        self.alerts["late"].append(t)
                else:
                    log.debug(f"[ALERT HISTORY] Skipping LATE alert at t={t} (already triggered at t={self.alert_states['late_trigger_time']})")

        self.alert_states["early"] = early_active
        self.alert_states["mid"] = mid_active
        self.alert_states["late"] = late_active

        if return_dict:
            return {
                "ewma": ewma,
                "slope": slope,
                "variance": rolling_var,
                "cycle_time": cycle_time,
                "t_fail": t_fail_api,
                "alerts": {
                    "early": early_active,
                    "mid": mid_active,
                    "late": late_active,
                    "early_trigger_time": self.alert_states["early_trigger_time"],
                    "mid_trigger_time": self.alert_states["mid_trigger_time"],
                    "late_trigger_time": self.alert_states["late_trigger_time"],
                }
            }
        return ewma


# =============================================================================
# 6.  LIVE PLOT
# =============================================================================

def _tk_available() -> bool:
    try:
        import tkinter  # noqa: F401
        return True
    except ImportError:
        return False


class LivePlot:
    """
    Rolling matplotlib window that updates in real time.
    Keeps only the last WINDOW cycles on screen to avoid memory growth.

    Alert depiction:
    - Background shading shows the active alert zone as it grows in real time:
        green  = EARLY tier active
        orange = MID tier active
        red    = LATE tier active
      Each tier's shading starts at first-trigger t and extends to the
      current t as long as the tier keeps firing.
    - A vertical dashed line + scatter marker is drawn at first trigger
      of each tier, using the correct EWMA value looked up by sim_t.
    """

    WINDOW = 300

    # Alert tier display config
    _TIER_STYLE = {
        "early": dict(color="green",  marker="^", s=800, shade="limegreen",  alpha=0.10),
        "mid":   dict(color="orange", marker="D", s=800, shade="orange",     alpha=0.12),
        "late":  dict(color="red", marker="x", s=1200, shade="red",        alpha=0.15),
    }

    def __init__(self, cfg: Config, run_meta: dict):
        matplotlib.use("TkAgg" if _tk_available() else "Agg")
        plt.ion()
        self.fig, self.ax = plt.subplots(figsize=(14, 5))
        try:
            self.fig.canvas.manager.set_window_title(
                f"Motor EWMA — run_id={run_meta['run_id']}"
            )
        except Exception:
            pass
        self.cfg = cfg

        # time → ewma lookup so markers use the exact EWMA at that sim_t
        self._t_to_ewma: dict[int, float] = {}

        self._times:   list[int]   = []
        self._current: list[float] = []
        self._ewma:    list[float] = []

        # Track what we have already drawn so we don't re-draw on every tick
        self._drawn_markers:  set[str] = set()   # tier names with marker drawn
        self._shade_patches:  dict[str, object] = {}   # tier → axvspan handle

        # Static control lines
        self.ax.axhline(cfg.MU,         ls="--", color="gray",   lw=1,   label=f"Mean ({cfg.MU} A)")
        self.ax.axhline(cfg.UCL_2SIGMA, ls="--", color="orange", lw=1.2, label=f"UCL 2σ ({cfg.UCL_2SIGMA:.2f} A)")
        self.ax.axhline(cfg.UCL_3SIGMA, ls="--", color="red",    lw=1.2, label=f"UCL 3σ ({cfg.UCL_3SIGMA:.2f} A)")

        self._line_raw,  = self.ax.plot([], [], alpha=0.25, color="steelblue", lw=0.8, label="Raw current")
        self._line_ewma, = self.ax.plot([], [], color="royalblue", lw=2, label="EWMA")

        self.ax.set_xlabel("Simulation cycle (t)")
        self.ax.set_ylabel("Motor current (A)")
        self.ax.legend(loc="upper left", fontsize=8, framealpha=0.8)
        self.ax.grid(True, alpha=0.3)
        plt.tight_layout()

    # ------------------------------------------------------------------
    def update(self, new_rows: list[dict], alert_system: AlertSystem) -> None:
        if not new_rows:
            return

        for row in new_rows:
            t = int(row["sim_t"])
            self._times.append(t)
            self._current.append(float(row["motor_current"]))

        # Build / extend the t→ewma lookup from the full history
        # alert_system.ewma_history is parallel to the order rows were
        # processed, and _times is built in the same order — so we can
        # zip them directly to get correct lookups.
        all_times = self._times            # full untruncated list so far
        all_ewma  = alert_system.ewma_history[-len(all_times):]
        for t, e in zip(all_times, all_ewma):
            self._t_to_ewma[t] = e

        # Sync display ewma list
        n = len(self._times)
        self._ewma = alert_system.ewma_history[-n:] if len(alert_system.ewma_history) >= n \
                     else alert_system.ewma_history[:]

        # Keep rolling window
        if len(self._times) > self.WINDOW:
            self._times   = self._times[-self.WINDOW:]
            self._current = self._current[-self.WINDOW:]
            self._ewma    = self._ewma[-self.WINDOW:]

        self._line_raw.set_data(self._times, self._current)
        self._line_ewma.set_data(self._times, self._ewma)

        current_t = self._times[-1] if self._times else 0

        # ── Per-tier: marker at first trigger + live background shading ──
        legend_dirty = False
        for tier, times in alert_system.alerts.items():
            if not times:
                continue

            first_t = times[0]
            last_t  = times[-1]    # most recent cycle this tier fired
            st      = self._TIER_STYLE[tier]

            # 1. First-trigger vertical line + scatter marker (drawn once)
            if tier not in self._drawn_markers:
                ewma_at_first = self._t_to_ewma.get(first_t)
                if ewma_at_first is not None:
                    self.ax.axvline(
                        first_t, color=st["color"], lw=1.5,
                        ls="--", alpha=0.8, zorder=4,
                    )
                    # Special handling for late alert to make it extra visible
                    if tier == "late":
                        self.ax.scatter(
                            first_t, ewma_at_first,
                            color="red", marker="x",
                            s=st["s"], zorder=6,
                            edgecolors='black', linewidths=6,
                            alpha=1.0,
                            label=f"First {tier.upper()} alert (t={first_t})",
                        )
                    else:
                        self.ax.scatter(
                            first_t, ewma_at_first,
                            color=st["color"], marker=st["marker"],
                            s=st["s"], zorder=6,
                            edgecolors='black', linewidths=2,
                            alpha=0.9,
                            label=f"First {tier.upper()} alert (t={first_t})",
                        )
                    self._drawn_markers.add(tier)
                    legend_dirty = True

            # 2. Background shading from first_t to last active t
            #    Remove old patch and redraw so the right edge follows current_t
            if tier in self._shade_patches:
                try:
                    self._shade_patches[tier].remove()
                except Exception:
                    pass

            shade_end = last_t + 1   # extend one cycle past last active t
            self._shade_patches[tier] = self.ax.axvspan(
                first_t, shade_end,
                color=st["shade"], alpha=st["alpha"], zorder=1,
            )

            # 3. Small text label at the top of the shaded zone
            #    (drawn fresh each tick — clear previous by tag isn't easy,
            #     so we just annotate at a fixed y and rely on overlap being
            #     acceptable since each tier occupies a unique y offset)

        if legend_dirty:
            self.ax.legend(loc="upper left", fontsize=8, framealpha=0.8)

        if self._times:
            pad = max(0.3, (max(self._current) - min(self._current)) * 0.1)
            self.ax.set_xlim(self._times[0], self._times[-1] + 1)
            self.ax.set_ylim(
                min(self._current + [self.cfg.MU]) - pad,
                max(self._current + [self.cfg.UCL_3SIGMA]) + pad,
            )
            ewma_now = self._ewma[-1] if self._ewma else 0.0

            # Active alert status in title
            active = [t.upper() for t in ["early", "mid", "late"]
                      if alert_system.alerts[t]]
            status = f"  ⚠ {' + '.join(active)}" if active else ""
            self.ax.set_title(
                f"Live Motor Current — t={current_t}  "
                f"EWMA={ewma_now:.3f} A{status}"
            )

        self.fig.canvas.draw_idle()
        self.fig.canvas.flush_events()

    def close(self) -> None:
        plt.ioff()
        plt.close(self.fig)


# =============================================================================
# 7.  REAL-TIME STREAMING LOOP
# =============================================================================

def run_realtime(
    db: DBConnection,
    run_id: int,
    run_meta: dict,
    cfg: Config,
    poll_interval: float = 1.0,
    enable_plot: bool = True,
) -> None:
    """
    Main real-time loop.

    Each iteration:
      1. Fetch new rows from DB (only rows with sim_t > last seen — fast).
      2. Feed each row into AlertSystem to keep EWMA continuous.
      3. Log progress and any new interrupt events.
      4. Update live plot.
      5. Sleep until next poll, waking early on LISTEN/NOTIFY if available.
      6. Exit cleanly when the run is closed or Ctrl+C is pressed.
    """

    alert_system = AlertSystem(cfg)
    plot = LivePlot(cfg, run_meta) if enable_plot else None

    last_sim_t    = 0
    last_event_t  = 0
    total_rows    = 0

    # LISTEN/NOTIFY for event-driven wake-up (falls back silently)
    listen_conn = setup_listen_notify(DATABASE_URL)

    # Graceful shutdown on Ctrl+C or SIGTERM
    _shutdown = {"flag": False}

    def _handle_signal(sig, frame):
        _shutdown["flag"] = True
        log.info("Shutdown signal received — finishing current cycle…")

    signal.signal(signal.SIGINT,  _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    log.info(
        f"Real-time streaming  run_id={run_id}  "
        f"poll={poll_interval}s  plot={'on' if enable_plot else 'off'}"
    )
    log.info("Press Ctrl+C to stop.\n")

    try:
        while not _shutdown["flag"]:
            poll_start = time.monotonic()

            # 1. New readings
            new_rows = fetch_new_rows(
                db, run_id,
                after_sim_t=last_sim_t,
                limit=cfg.fetch_limit,
            )
            if new_rows:
                for row in new_rows:
                    alert_system.process(int(row["sim_t"]), float(row["motor_current"]))
                    last_sim_t = max(last_sim_t, int(row["sim_t"]))
                total_rows += len(new_rows)
                log.info(
                    f"t={last_sim_t:>6}  "
                    f"I={float(new_rows[-1]['motor_current']):.3f} A  "
                    f"EWMA={alert_system.ewma_prev:.3f} A  "
                    f"(+{len(new_rows)} rows | total={total_rows})"
                )

            # 2. New interrupt events
            new_events = fetch_new_events(db, run_id, after_sim_t=last_event_t)
            for ev in new_events:
                last_event_t = max(last_event_t, int(ev["sim_t"]))
                log.info(
                    f"  ↳ [INTERRUPT] t={ev['sim_t']}  "
                    f"action={ev['action']}  "
                    f"new_wear_rate={float(ev['new_wear_rate']):.4f}"
                )

            # 3. Update plot
            if plot is not None and new_rows:
                plot.update(new_rows, alert_system)

            # 4. Check if run was closed by the simulator
            if not is_run_active(db, run_id):
                # Drain any last rows that arrived just before close
                tail = fetch_new_rows(db, run_id, after_sim_t=last_sim_t)
                for row in tail:
                    alert_system.process(int(row["sim_t"]), float(row["motor_current"]))
                    last_sim_t = max(last_sim_t, int(row["sim_t"]))
                if tail and plot is not None:
                    plot.update(tail, alert_system)
                log.info("Run closed by simulator — stopping stream.")
                break

            # 5. Sleep until next poll (wake early on NOTIFY)
            elapsed = time.monotonic() - poll_start
            wait    = max(0.0, poll_interval - elapsed)

            if listen_conn is not None:
                try:
                    ready = select.select([listen_conn], [], [], wait)[0]
                    if ready:
                        listen_conn.notifies()   # drain notification queue
                except Exception:
                    listen_conn = None
            else:
                time.sleep(wait)

    finally:
        _print_summary(alert_system, total_rows, last_sim_t, run_meta)
        if listen_conn is not None:
            try:
                listen_conn.close()
            except Exception:
                pass
        if plot is not None:
            plt.ioff()
            log.info("Close the plot window to exit.")
            plt.show(block=True)
        db.close()


# =============================================================================
# 8.  STATIC REPLAY  (closed run — full pass in one go)
# =============================================================================

def run_replay(
    db: DBConnection,
    run_id: int,
    run_meta: dict,
    cfg: Config,
    plot_start: Optional[int],
    plot_end: Optional[int],
    enable_plot: bool,
) -> None:
    """Load a full stored run and run the EWMA pipeline in a single pass."""

    rows = db.execute(
        """
        SELECT sim_t, motor_current, cycle_time, i_base,
               wear_rate, degradation, k_noise, noise, recorded_at
        FROM simulation_readings
        WHERE run_id = %s
        ORDER BY sim_t ASC
        """,
        (run_id,),
    ).fetchall()

    events = db.execute(
        """
        SELECT sim_t, new_wear_rate, i_base_noted, action
        FROM simulation_interrupt_events
        WHERE run_id = %s ORDER BY sim_t ASC
        """,
        (run_id,),
    ).fetchall()

    if not rows:
        sys.exit(f"run_id={run_id} has no readings.")

    df = pd.DataFrame([dict(r) for r in rows])
    events_df = pd.DataFrame([dict(e) for e in events])

    for col in ["motor_current", "cycle_time", "i_base", "wear_rate",
                "degradation", "k_noise", "noise"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    log.info(
        f"Replaying run_id={run_id}  "
        f"({len(df)} rows, t={df['sim_t'].min()}…{df['sim_t'].max()})"
    )

    alert_system = AlertSystem(cfg)
    ewma_vals = [
        alert_system.process(int(t), float(c))
        for t, c in zip(df["sim_t"], df["motor_current"])
    ]
    df["ewma"] = ewma_vals

    _print_summary(alert_system, len(df), int(df["sim_t"].max()), run_meta)

    if not enable_plot:
        db.close()
        return

    # Auto plot window centred on first alert
    all_alert_t = [t for tl in alert_system.alerts.values() for t in tl]
    if plot_start is not None:
        ps = plot_start
        pe = plot_end if plot_end is not None else int(df["sim_t"].max())
    elif all_alert_t:
        fa = min(all_alert_t)
        ps = max(int(df["sim_t"].min()), fa - 200)
        pe = min(int(df["sim_t"].max()), fa + 400)
    else:
        ps = int(df["sim_t"].min())
        pe = int(df["sim_t"].max())

    _plot_static(df, events_df, cfg, alert_system.alerts, run_meta, ps, pe)
    db.close()


def _plot_static(
    df: pd.DataFrame,
    events_df: pd.DataFrame,
    cfg: Config,
    alerts: dict,
    run_meta: dict,
    start: int,
    end: int,
) -> None:
    subset = df[(df["sim_t"] >= start) & (df["sim_t"] <= end)]
    fig, ax = plt.subplots(figsize=(15, 6))

    ax.plot(subset["sim_t"], subset["motor_current"],
            alpha=0.25, color="steelblue", lw=0.8, label="Raw current")
    ax.plot(subset["sim_t"], subset["ewma"],
            lw=2, color="royalblue", label="EWMA")

    ax.axhline(cfg.MU,         ls="--", color="gray",   lw=1,   label=f"Mean ({cfg.MU} A)")
    ax.axhline(cfg.UCL_2SIGMA, ls="--", color="orange", lw=1.2, label=f"UCL 2σ ({cfg.UCL_2SIGMA:.2f} A)")
    ax.axhline(cfg.UCL_3SIGMA, ls="--", color="red",    lw=1.2, label=f"UCL 3σ ({cfg.UCL_3SIGMA:.2f} A)")

    # Interrupt event markers
    if len(events_df) > 0:
        vis = events_df[(events_df["sim_t"] >= start) & (events_df["sim_t"] <= end)]
        for _, ev in vis.iterrows():
            color = "#d62728" if ev["action"] == "RESET" else "#9467bd"
            ax.axvline(ev["sim_t"], color=color, lw=1, ls=":", alpha=0.7)
            ax.text(
                ev["sim_t"],
                cfg.UCL_3SIGMA + 0.15,
                f" {ev['action'] or 'EVENT'}\n wr={float(ev['new_wear_rate']):.3f}",
                fontsize=7, color=color, va="bottom",
            )

    # First-alert scatter markers
    alert_styles = {
        "early": dict(color="green",  marker="^", s=800),
        "mid":   dict(color="orange", marker="D", s=800),
        "late":  dict(color="red", marker="x", s=1200),
    }
    for tier, times in alerts.items():
        for t in times:
            if start <= t <= end:
                row = df[df["sim_t"] == t]
                if not row.empty:
                    st = alert_styles[tier]
                    # Special handling for late alert to make it extra visible
                    if tier == "late":
                        ax.scatter(
                            t, row["ewma"].values[0],
                            color="red", marker="x",
                            s=st["s"], zorder=5,
                            edgecolors='black', linewidths=6,
                            alpha=1.0,
                            label=f"First {tier.upper()} alert (t={t})",
                        )
                    else:
                        ax.scatter(
                            t, row["ewma"].values[0],
                            color=st["color"], marker=st["marker"],
                            s=st["s"], zorder=5,
                            edgecolors='black', linewidths=2,
                            alpha=0.9,
                            label=f"First {tier.upper()} alert (t={t})",
                        )
                break

    ax.set_title(
        f"Motor Current Control Chart — run_id={run_meta['run_id']}  "
        f"(t={start}–{end})",
        fontsize=13,
    )
    ax.set_xlabel("Simulation cycle (t)")
    ax.set_ylabel("Motor current (A)")
    ax.legend(loc="upper left", fontsize=8, framealpha=0.8)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.show()


# =============================================================================
# 9.  MULTI-RUN SUMMARY
# =============================================================================

def run_all_summary(db: DBConnection, cfg: Config) -> None:
    run_ids = [
        row["run_id"] for row in db.execute(
            """
            SELECT run_id FROM simulation_runs
            WHERE EXISTS (
                SELECT 1 FROM simulation_readings sr
                WHERE sr.run_id = simulation_runs.run_id
            )
            ORDER BY run_id
            """
        ).fetchall()
    ]

    if not run_ids:
        log.info("No runs found in the database.")
        db.close()
        return

    summary_rows = []
    for rid in run_ids:
        _, meta = resolve_run_id(db, rid)
        readings = db.execute(
            "SELECT sim_t, motor_current FROM simulation_readings "
            "WHERE run_id = %s ORDER BY sim_t ASC",
            (rid,),
        ).fetchall()
        n_events = db.execute(
            "SELECT COUNT(*) AS c FROM simulation_interrupt_events WHERE run_id = %s",
            (rid,),
        ).fetchone()["c"]

        sys_ = AlertSystem(cfg)
        for row in readings:
            sys_.process(int(row["sim_t"]), float(row["motor_current"]))

        summary_rows.append({
            "run_id":      rid,
            "run_name":    meta.get("run_name"),
            "n_readings":  len(readings),
            "n_events":    n_events,
            "first_early": sys_.alerts["early"][0] if sys_.alerts["early"] else None,
            "first_mid":   sys_.alerts["mid"][0]   if sys_.alerts["mid"]   else None,
            "first_late":  sys_.alerts["late"][0]  if sys_.alerts["late"] else None,
            "started_at":  meta.get("started_at"),
        })

    print("\nAll-runs summary:")
    print(pd.DataFrame(summary_rows).to_string(index=False))
    db.close()


# =============================================================================
# 10.  SHARED HELPER
# =============================================================================

def _print_summary(
    alert_system: AlertSystem,
    total_rows: int,
    last_sim_t: int,
    run_meta: dict,
) -> None:
    print("\n" + "─" * 60)
    print(f"  Run summary  run_id={run_meta['run_id']}  ({run_meta.get('run_name', '')})")
    print(f"  Cycles processed : {total_rows}")
    print(f"  Last sim_t       : {last_sim_t}")
    counts = {k: len(v) for k, v in alert_system.alerts.items()}
    print(f"  Alert counts     : {counts}")
    for tier, times in alert_system.alerts.items():
        if times:
            print(f"    First {tier.upper():5s} alert at t={times[0]}")
    print("─" * 60 + "\n")


# =============================================================================
# 11.  ENTRY POINT
# =============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Real-time motor EWMA alert pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--run-id", type=int, default=None,
        help="run_id to analyse (default: latest)"
    )
    parser.add_argument(
        "--all-runs", action="store_true",
        help="Print summary table for all stored runs and exit"
    )
    parser.add_argument(
        "--no-plot", action="store_true",
        help="Suppress the matplotlib window"
    )
    parser.add_argument(
        "--poll", type=float, default=1.0, metavar="SECONDS",
        help="Poll interval in seconds for live mode (default: 1)"
    )
    parser.add_argument(
        "--start", type=int, default=None,
        help="Plot window start cycle (replay mode only)"
    )
    parser.add_argument(
        "--end", type=int, default=None,
        help="Plot window end cycle (replay mode only)"
    )
    args = parser.parse_args()

    db  = DBConnection(DATABASE_URL)
    cfg = Config()

    if args.all_runs:
        run_all_summary(db, cfg)
        return

    run_id, run_meta = resolve_run_id(db, args.run_id)
    log.info(
        f"run_id={run_id}  name={run_meta.get('run_name')}  "
        f"started={run_meta.get('started_at')}  "
        f"ended={run_meta.get('ended_at') or '(active)'}"
    )

    if is_run_active(db, run_id):
        log.info("Run is active — entering real-time streaming mode.")
        run_realtime(
            db, run_id, run_meta, cfg,
            poll_interval=args.poll,
            enable_plot=not args.no_plot,
        )
    else:
        log.info("Run is closed — replaying in static mode.")
        run_replay(
            db, run_id, run_meta, cfg,
            plot_start=args.start,
            plot_end=args.end,
            enable_plot=not args.no_plot,
        )


if __name__ == "__main__":
    main()
