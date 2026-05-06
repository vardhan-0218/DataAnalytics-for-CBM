"""
Motor Wear Simulator — EWMA Alert Analysis
==========================================
Reads simulation data from PostgreSQL and runs the EWMA / alert pipeline.

Place this file inside the data_generation/ folder alongside app.py,
simulate.py, db_store.py, db_schema.sql, and analytics_views.sql.

Usage
-----
    python analysis.py                  # analyses the latest run
    python analysis.py --run-id 3       # analyses a specific run
    python analysis.py --all-runs       # summary table across all runs
    python analysis.py --start 200 --end 800   # custom plot window

DATABASE_URL is read from the environment or from a .env file in the
same directory as this script.
"""

import argparse
import os
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

# ── psycopg import ────────────────────────────────────────────────────────────
try:
    import psycopg
except ImportError:
    sys.exit(
        "psycopg is not installed.\n"
        "Run:  pip install 'psycopg[binary]'"
    )


# ─────────────────────────────────────────────────────────────────────────────
# 1.  DATABASE URL  (env var or .env file in the same directory)
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# 2.  CONFIG
# ─────────────────────────────────────────────────────────────────────────────

class Config:
    """
    All tunable parameters for the EWMA alert pipeline.

    MU / SIGMA reflect the healthy-state motor current produced by the
    simulator (I_BASE_INIT = 5.0 A, SIGMA_INIT = 0.1 A at zero wear).
    Adjust if your run used different baseline settings.
    """
    def __init__(
        self,
        I_BASE=5.0,
        MU=5.0,
        SIGMA=0.25,
        S_EARLY=0.005,
        S_MID=0.01,
        S_LATE=0.02,
        VAR_STABLE=0.05,
        CT_BASELINE=2.0,
        CT_EARLY_PCT=0.03,
        CT_LATE_PCT=0.05,
        I_THRESHOLD=10.0,
        alpha=0.1,
        k_noise=0.1,
    ):
        self.I_BASE = I_BASE
        self.MU = MU
        self.SIGMA = SIGMA

        self.UCL_2SIGMA = MU + 2 * SIGMA
        self.UCL_3SIGMA = MU + 3 * SIGMA

        self.S_EARLY = S_EARLY
        self.S_MID = S_MID
        self.S_LATE = S_LATE
        self.VAR_STABLE = VAR_STABLE

        self.CT_BASELINE = CT_BASELINE
        self.CT_EARLY_THRESHOLD = CT_BASELINE * (1 + CT_EARLY_PCT)
        self.CT_LATE_THRESHOLD = CT_BASELINE * (1 + CT_LATE_PCT)

        self.I_THRESHOLD = I_THRESHOLD
        self.alpha = alpha
        self.k_noise = k_noise


# ─────────────────────────────────────────────────────────────────────────────
# 3.  DATABASE LOADER
# ─────────────────────────────────────────────────────────────────────────────

def load_run_from_db(
    db_url: str,
    run_id: int | None = None,
    require_closed: bool = False,
) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """
    Returns (readings_df, events_df, run_meta).

    readings_df columns : sim_t, motor_current, cycle_time, i_base,
                          wear_rate, degradation, k_noise, noise, recorded_at
    events_df columns   : sim_t, new_wear_rate, i_base_noted, action, recorded_at
    run_meta            : dict with run_id, run_name, started_at, ended_at

    If run_id is None, picks the run with the highest run_id that has
    at least one reading row.  Set require_closed=True to skip active runs.
    """
    with psycopg.connect(db_url) as conn:
        if run_id is None:
            closed_filter = "AND r.ended_at IS NOT NULL" if require_closed else ""
            row = conn.execute(
                f"""
                SELECT r.run_id, r.run_name, r.started_at, r.ended_at
                FROM simulation_runs r
                WHERE EXISTS (
                    SELECT 1 FROM simulation_readings sr WHERE sr.run_id = r.run_id
                )
                {closed_filter}
                ORDER BY r.run_id DESC
                LIMIT 1
                """
            ).fetchone()
            if row is None:
                sys.exit(
                    "No runs with readings found in the database.\n"
                    "Run the Streamlit simulator first (streamlit run app.py) "
                    "and generate some data."
                )
            run_id, run_name, started_at, ended_at = row
        else:
            row = conn.execute(
                "SELECT run_id, run_name, started_at, ended_at "
                "FROM simulation_runs WHERE run_id = %s",
                (run_id,),
            ).fetchone()
            if row is None:
                sys.exit(f"run_id={run_id} not found in the database.")
            run_id, run_name, started_at, ended_at = row

        run_meta = {
            "run_id": run_id,
            "run_name": run_name,
            "started_at": started_at,
            "ended_at": ended_at,
        }

        readings_df = pd.read_sql(
            """
            SELECT sim_t, motor_current, cycle_time,
                   i_base, wear_rate, degradation, k_noise, noise,
                   recorded_at
            FROM simulation_readings
            WHERE run_id = %(run_id)s
            ORDER BY sim_t ASC
            """,
            conn,
            params={"run_id": run_id},
        )

        events_df = pd.read_sql(
            """
            SELECT sim_t, new_wear_rate, i_base_noted, action, recorded_at
            FROM simulation_interrupt_events
            WHERE run_id = %(run_id)s
            ORDER BY sim_t ASC
            """,
            conn,
            params={"run_id": run_id},
        )

    return readings_df, events_df, run_meta


# ─────────────────────────────────────────────────────────────────────────────
# 4.  ALERT SYSTEM
# ─────────────────────────────────────────────────────────────────────────────

class AlertSystem:
    """
    Processes motor current readings one cycle at a time and classifies them
    into three wear-stage alert tiers.

    Tier    Trigger condition (all must be true simultaneously)
    ------  ---------------------------------------------------
    EARLY   EWMA below UCL_2σ  AND slope > S_EARLY AND variance stable
    MID     EWMA above UCL_2σ  AND slope > S_MID   AND cycle_time elevated
    LATE    EWMA above UCL_3σ  AND slope > S_LATE  AND cycle_time high
    """

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.ewma_prev = cfg.MU
        self.ewma_history: list[float] = []
        self.window: list[float] = []
        self.window_size = 50
        self.alerts: dict[str, list[int]] = {
            "early": [],
            "mid": [],
            "late": [],
        }

    def process(self, t: int, current: float) -> float:
        """Advance one cycle. Returns the EWMA value for this cycle."""
        cfg = self.cfg

        ewma = cfg.alpha * current + (1 - cfg.alpha) * self.ewma_prev
        self.ewma_prev = ewma
        self.ewma_history.append(ewma)

        self.window.append(current)
        if len(self.window) > self.window_size:
            self.window.pop(0)
        rolling_var = np.var(self.window) if len(self.window) > 10 else 0.0

        k = 10
        slope = (
            (ewma - self.ewma_history[-k]) / k
            if len(self.ewma_history) > k
            else 0.0
        )

        cycle_time = cfg.CT_BASELINE + 0.2 * (ewma - cfg.MU)
        t_fail = (
            (cfg.I_THRESHOLD - ewma) / slope if slope > 0 else float("inf")
        )

        if (
            ewma < cfg.UCL_2SIGMA
            and slope > cfg.S_EARLY
            and rolling_var < cfg.VAR_STABLE
        ):
            if not self.alerts["early"]:
                print(f"[EARLY] t={t}  EWMA={ewma:.3f}  slope={slope:.5f}  T_fail={t_fail:.0f}")
            self.alerts["early"].append(t)

        if (
            ewma > cfg.UCL_2SIGMA
            and slope > cfg.S_MID
            and cycle_time > cfg.CT_EARLY_THRESHOLD
        ):
            if not self.alerts["mid"]:
                print(f"[MID]   t={t}  EWMA={ewma:.3f}  slope={slope:.5f}  T_fail={t_fail:.0f}")
            self.alerts["mid"].append(t)

        if (
            ewma > cfg.UCL_3SIGMA
            and slope > cfg.S_LATE
            and cycle_time > cfg.CT_LATE_THRESHOLD
        ):
            if not self.alerts["late"]:
                print(f"[LATE]  t={t}  EWMA={ewma:.3f}  slope={slope:.5f}  T_fail={t_fail:.0f}")
            self.alerts["late"].append(t)

        return ewma


# ─────────────────────────────────────────────────────────────────────────────
# 5.  PLOT
# ─────────────────────────────────────────────────────────────────────────────

def plot_control_chart(
    df: pd.DataFrame,
    cfg: Config,
    alerts: dict,
    events_df: pd.DataFrame,
    run_meta: dict,
    start: int,
    end: int,
) -> None:
    subset = df[(df["time"] >= start) & (df["time"] <= end)]

    fig, ax = plt.subplots(figsize=(15, 6))

    ax.plot(subset["time"], subset["current"],
            alpha=0.25, color="steelblue", linewidth=0.8, label="Raw current")
    ax.plot(subset["time"], subset["ewma"],
            linewidth=2, color="royalblue", label="EWMA")

    ax.axhline(cfg.MU,         linestyle="--", color="gray",   linewidth=1,   label=f"Mean ({cfg.MU} A)")
    ax.axhline(cfg.UCL_2SIGMA, linestyle="--", color="orange", linewidth=1.2, label=f"UCL 2σ ({cfg.UCL_2SIGMA:.2f} A)")
    ax.axhline(cfg.UCL_3SIGMA, linestyle="--", color="red",    linewidth=1.2, label=f"UCL 3σ ({cfg.UCL_3SIGMA:.2f} A)")

    # Interrupt events
    if events_df is not None and len(events_df) > 0:
        visible = events_df[
            (events_df["sim_t"] >= start) & (events_df["sim_t"] <= end)
        ]
        for _, ev in visible.iterrows():
            color = "#d62728" if ev["action"] == "RESET" else "#9467bd"
            ax.axvline(ev["sim_t"], color=color, linewidth=1, linestyle=":", alpha=0.7)
            ax.text(
                ev["sim_t"],
                ax.get_ylim()[1] * 0.98,
                f" {ev['action'] or 'EVENT'}\n wr={float(ev['new_wear_rate']):.3f}",
                fontsize=7, color=color, va="top",
            )

    # First-alert markers
    alert_styles = {
        "early": dict(color="green",  marker="^", s=120, label="First EARLY alert"),
        "mid":   dict(color="orange", marker="D", s=120, label="First MID alert"),
        "late":  dict(color="red",    marker="X", s=150, label="First LATE alert"),
    }
    for tier, times in alerts.items():
        for t in times:
            if start <= t <= end:
                row = df[df["time"] == t]
                if not row.empty:
                    st = alert_styles[tier]
                    ax.scatter(
                        t, row["ewma"].values[0],
                        color=st["color"], marker=st["marker"],
                        s=st["s"], zorder=5, label=st["label"],
                    )
                break

    ax.set_title(
        f"Motor Current Control Chart — run_id={run_meta['run_id']} "
        f"(t={start}–{end})",
        fontsize=13,
    )
    ax.set_xlabel("Simulation cycle (t)")
    ax.set_ylabel("Motor current (A)")
    ax.legend(loc="upper left", fontsize=8, framealpha=0.8)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.show()


# ─────────────────────────────────────────────────────────────────────────────
# 6.  MULTI-RUN SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

def summarise_all_runs(db_url: str, cfg: Config) -> pd.DataFrame:
    """Run the EWMA pipeline over every stored run and return a summary table."""
    with psycopg.connect(db_url) as conn:
        run_ids = [
            row[0] for row in conn.execute(
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

    rows = []
    for rid in run_ids:
        r_df, e_df, meta = load_run_from_db(db_url, run_id=rid)
        r_df = r_df.rename(columns={"sim_t": "time", "motor_current": "current"})
        r_df["current"] = pd.to_numeric(r_df["current"], errors="coerce")
        r_df = r_df.sort_values("time").reset_index(drop=True)

        sys_ = AlertSystem(cfg)
        for t, c in zip(r_df["time"], r_df["current"]):
            sys_.process(t, c)

        rows.append({
            "run_id":       rid,
            "run_name":     meta["run_name"],
            "n_readings":   len(r_df),
            "n_events":     len(e_df),
            "first_early":  sys_.alerts["early"][0] if sys_.alerts["early"] else None,
            "first_mid":    sys_.alerts["mid"][0]   if sys_.alerts["mid"]   else None,
            "first_late":   sys_.alerts["late"][0]  if sys_.alerts["late"] else None,
            "started_at":   meta["started_at"],
        })

    return pd.DataFrame(rows)


# ─────────────────────────────────────────────────────────────────────────────
# 7.  MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Motor EWMA alert analysis")
    parser.add_argument("--run-id",  type=int,  default=None, help="Specific run_id to analyse (default: latest)")
    parser.add_argument("--all-runs", action="store_true",    help="Print summary table for all stored runs")
    parser.add_argument("--start",   type=int,  default=None, help="Plot window start (default: auto)")
    parser.add_argument("--end",     type=int,  default=None, help="Plot window end (default: auto)")
    args = parser.parse_args()

    cfg = Config()

    # ── All-runs summary mode ─────────────────────────────────────────────
    if args.all_runs:
        print("Summarising all runs…")
        summary = summarise_all_runs(DATABASE_URL, cfg)
        print(summary.to_string(index=False))
        return

    # ── Single-run analysis ───────────────────────────────────────────────
    readings_df, events_df, run_meta = load_run_from_db(DATABASE_URL, run_id=args.run_id)

    print(f"Run ID     : {run_meta['run_id']}")
    print(f"Run name   : {run_meta['run_name']}")
    print(f"Started at : {run_meta['started_at']}")
    print(f"Ended at   : {run_meta['ended_at'] or '(still running)'}")
    print(f"Readings   : {len(readings_df)} rows  "
          f"(t={readings_df['sim_t'].min()} … {readings_df['sim_t'].max()})")
    print(f"Events     : {len(events_df)} interrupt(s)")

    # Align column names for the alert pipeline
    df = readings_df.rename(columns={"sim_t": "time", "motor_current": "current"}).copy()
    for col in ["current", "cycle_time", "i_base", "wear_rate", "degradation", "k_noise", "noise"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.sort_values("time").reset_index(drop=True)

    # Run EWMA pipeline
    alert_system = AlertSystem(cfg)
    ewma_values = [alert_system.process(t, c) for t, c in zip(df["time"], df["current"])]
    df["ewma"] = ewma_values

    print("\nAlert counts:", {k: len(v) for k, v in alert_system.alerts.items()})
    for tier, times in alert_system.alerts.items():
        if times:
            print(f"  First {tier.upper()} alert at t={times[0]}")

    # Determine plot window
    all_alert_times = [t for times in alert_system.alerts.values() for t in times]
    if args.start is not None:
        plot_start = args.start
        plot_end   = args.end if args.end is not None else df["time"].max()
    elif all_alert_times:
        first_alert = min(all_alert_times)
        plot_start  = max(df["time"].min(), first_alert - 200)
        plot_end    = min(df["time"].max(), first_alert + 400)
    else:
        plot_start = df["time"].min()
        plot_end   = df["time"].max()

    print(f"\nPlotting t={plot_start} to t={plot_end}")
    plot_control_chart(df, cfg, alert_system.alerts, events_df, run_meta, plot_start, plot_end)


if __name__ == "__main__":
    main()
