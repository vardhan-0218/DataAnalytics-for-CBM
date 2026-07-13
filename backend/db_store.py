import os
from typing import Any, Iterable
import importlib
import importlib.util
from pathlib import Path

psycopg = importlib.import_module("psycopg") if importlib.util.find_spec("psycopg") else None


def _get_db_url() -> str:
    db_url = os.getenv("DATABASE_URL", "").strip()
    if db_url:
        return db_url

    # Fallback for local runs where .env is present but not exported in shell.
    env_path = Path(__file__).with_name(".env")
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            if key.strip() == "DATABASE_URL":
                return value.strip().strip('"').strip("'")

    return ""


def db_is_configured() -> bool:
    return bool(_get_db_url())


def db_is_ready() -> bool:
    return db_is_configured() and psycopg is not None


def _connect():
    if psycopg is None:
        raise RuntimeError("psycopg is not installed. Run: pip install 'psycopg[binary]'")

    db_url = _get_db_url()
    if not db_url:
        raise RuntimeError("DATABASE_URL is not set.")

    return psycopg.connect(db_url)


def create_run_record(
    run_name: str | None = None,
    notes: str | None = None,
    source_app: str = "streamlit-motor-wear-simulator",
) -> int:
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO simulation_runs (run_name, source_app, notes)
                VALUES (%s, %s, %s)
                RETURNING run_id
                """,
                (run_name, source_app, notes),
            )
            run_id = cur.fetchone()[0]
        conn.commit()
    return int(run_id)


def flush_run_batch(
    run_id: int,
    readings: Iterable[dict[str, Any]] = (),
    events: Iterable[dict[str, Any]] = (),
) -> tuple[int, int]:
    readings_count = append_readings(run_id, readings)
    events_count = append_interrupts(run_id, events)
    return readings_count, events_count


def close_run_record(run_id: int) -> None:
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE simulation_runs SET ended_at = NOW() WHERE run_id = %s",
                (run_id,),
            )
        conn.commit()


def append_readings(run_id: int, rows: Iterable[dict[str, Any]]) -> int:
    payload = [
        (
            run_id,
            row["timestamp"],
            row["t"],
            row["I_base"],
            row["wear_rate"],
            row["degradation"],
            row["k_noise"],
            row["noise"],
            row["motor_current"],
            row["cycle_time"],
        )
        for row in rows
    ]

    if not payload:
        return 0

    with _connect() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO simulation_readings
                (run_id, recorded_at, sim_t, i_base, wear_rate, degradation, k_noise, noise, motor_current, cycle_time)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (run_id, sim_t) DO NOTHING
                """,
                payload,
            )
        conn.commit()

    return len(payload)


def append_interrupts(run_id: int, events: Iterable[dict[str, Any]]) -> int:
    payload = [
        (
            run_id,
            event["timestamp"],
            event["time"],
            event["new_wear_rate"],
            event["I_base_noted"],
            event.get("action"),
        )
        for event in events
    ]

    if not payload:
        return 0

    with _connect() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO simulation_interrupt_events
                (run_id, recorded_at, sim_t, new_wear_rate, i_base_noted, action)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                payload,
            )
        conn.commit()

    return len(payload)


# ══════════════════════════════════════════════════════════════
# NEW — CBM synthetic window persistence
# ══════════════════════════════════════════════════════════════

def ensure_cbm_table() -> None:
    """Create cbm_windows table if it does not exist."""
    if not db_is_ready():
        return
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS cbm_windows (
                    id                  SERIAL PRIMARY KEY,
                    recorded_at         TIMESTAMPTZ DEFAULT NOW(),
                    window_idx          INTEGER,
                    signal_type         TEXT,
                    fault_mode          TEXT,
                    severity_bearing    FLOAT DEFAULT 0,
                    severity_blade      FLOAT DEFAULT 0,
                    severity_misalignment FLOAT DEFAULT 0,
                    severity_imbalance    FLOAT DEFAULT 0,
                    severity_looseness    FLOAT DEFAULT 0,
                    severity_material_buildup FLOAT DEFAULT 0,
                    severity_partial_clogging FLOAT DEFAULT 0,
                    severity_choking      FLOAT DEFAULT 0,

                    -- Vibration features
                    vib_rms             FLOAT,
                    vib_kurtosis        FLOAT,
                    vib_crest_factor    FLOAT,
                    vib_spectral_centroid FLOAT,
                    vib_mid_band_energy FLOAT,
                    vib_thd             FLOAT,

                    -- Current features
                    cur_rms             FLOAT,
                    cur_kurtosis        FLOAT,
                    cur_thd             FLOAT,

                    -- Temperature features
                    temp_mean           FLOAT,
                    temp_rms            FLOAT,

                    -- Health indices
                    mhi                 FLOAT,
                    pqi                 FLOAT,
                    gqi                 FLOAT,
                    alarm_severity      TEXT,
                    min_index           FLOAT,

                    -- KPIs
                    cycle_time          FLOAT,
                    throughput          FLOAT,
                    grinding_efficiency FLOAT,
                    load_ratio          FLOAT,
                    batch_mass          FLOAT
                )
            """)
        conn.commit()


def insert_cbm_window(record: dict) -> None:
    """Persist one synthetic health window to cbm_windows."""
    if not db_is_ready():
        return
    ensure_cbm_table()

    features = record.get("features", {})
    vib = features.get("vibration", {})
    cur = features.get("current", {})
    tmp = features.get("temperature", {})
    idx = record.get("indices", {})
    alm = record.get("alarms", {})
    kpi = record.get("kpis", {})
    sev = record.get("severity", {})

    with _connect() as conn:
        with conn.cursor() as cur_conn:
            cur_conn.execute("""
                INSERT INTO cbm_windows (
                    window_idx,
                    fault_mode,
                    severity_bearing, severity_blade,
                    severity_misalignment, severity_imbalance, severity_looseness,
                    severity_material_buildup, severity_partial_clogging, severity_choking,

                    vib_rms, vib_kurtosis, vib_crest_factor,
                    vib_spectral_centroid, vib_mid_band_energy, vib_thd,

                    cur_rms, cur_kurtosis, cur_thd,

                    temp_mean, temp_rms,

                    mhi, pqi, gqi, alarm_severity, min_index,

                    cycle_time, throughput, grinding_efficiency,
                    load_ratio, batch_mass
                ) VALUES (
                    %(window_idx)s,
                    %(fault_mode)s,
                    %(severity_bearing)s, %(severity_blade)s,
                    %(severity_misalignment)s, %(severity_imbalance)s, %(severity_looseness)s,
                    %(severity_material_buildup)s, %(severity_partial_clogging)s, %(severity_choking)s,

                    %(vib_rms)s, %(vib_kurtosis)s, %(vib_crest_factor)s,
                    %(vib_spectral_centroid)s, %(vib_mid_band_energy)s, %(vib_thd)s,

                    %(cur_rms)s, %(cur_kurtosis)s, %(cur_thd)s,

                    %(temp_mean)s, %(temp_rms)s,

                    %(mhi)s, %(pqi)s, %(gqi)s, %(alarm_severity)s, %(min_index)s,

                    %(cycle_time)s, %(throughput)s, %(grinding_efficiency)s,
                    %(load_ratio)s, %(batch_mass)s
                )
            """, {
                "window_idx":          record.get("window_idx", 0),
                "fault_mode":          alm.get("severity", "NORMAL"),
                "severity_bearing":    sev.get("bearing_fault", 0.0),
                "severity_blade":      sev.get("blade_wear", 0.0),
                "severity_misalignment": sev.get("misalignment", 0.0),
                "severity_imbalance":  sev.get("imbalance", 0.0),
                "severity_looseness":  sev.get("looseness", 0.0),
                "severity_material_buildup": sev.get("material_buildup", 0.0),
                "severity_partial_clogging": sev.get("partial_clogging", 0.0),
                "severity_choking":    sev.get("choking", 0.0),

                "vib_rms":             vib.get("RMS"),
                "vib_kurtosis":        vib.get("Kurtosis"),
                "vib_crest_factor":    vib.get("CrestFactor"),
                "vib_spectral_centroid": vib.get("SpectralCentroid"),
                "vib_mid_band_energy": vib.get("MidBandEnergy"),
                "vib_thd":             vib.get("THD"),

                "cur_rms":             cur.get("RMS"),
                "cur_kurtosis":        cur.get("Kurtosis"),
                "cur_thd":             cur.get("THD"),

                "temp_mean":           tmp.get("Mean"),
                "temp_rms":            tmp.get("RMS"),

                "mhi":                 idx.get("MHI"),
                "pqi":                 idx.get("PQI"),
                "gqi":                 idx.get("GQI"),
                "alarm_severity":      alm.get("severity"),
                "min_index":           alm.get("min_index"),

                "cycle_time":          kpi.get("CycleTime"),
                "throughput":          kpi.get("Throughput"),
                "grinding_efficiency": kpi.get("GrindingEfficiency"),
                "load_ratio":          kpi.get("LoadRatio"),
                "batch_mass":          kpi.get("BatchMass"),
            })
        conn.commit()

