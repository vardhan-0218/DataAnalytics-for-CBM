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
