"""
app.py — Streamlit UI for the Motor Wear Simulator.

This UI is a REST client of the FastAPI backend (http://localhost:8000).
It shares the same MotorSimulator state as the React dashboard.

Architecture:
  React UI ──┐
             ├──► FastAPI :8000  (single MotorSimulator)
  Streamlit ─┘   └─► data_generation.py

Parameter changes in either UI hit the same FastAPI endpoints,
so both frontends always reflect the same simulation state.
"""

import time as time_module
import requests
import pandas as pd
import numpy as np
import streamlit as st
import plotly.graph_objects as go

# Import EWMA analysis classes from analysis.py (classes only — skip DB/main blocks)
import importlib.util, sys as _sys, types as _types

def _import_analysis_classes():
    """Load Config + AlertSystem from analysis.py without triggering the
    DATABASE_URL sys.exit() that runs at module scope."""
    spec = importlib.util.spec_from_file_location(
        "_analysis_classes",
        __import__('pathlib').Path(__file__).with_name('analysis.py')
    )
    # Temporarily stub psycopg and patch sys.exit so the top-level guard is a no-op
    _orig_exit = _sys.exit
    _sys.exit = lambda *a, **k: None
    _sys.modules.setdefault('psycopg', _types.ModuleType('psycopg'))
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception:
        mod = None
    finally:
        _sys.exit = _orig_exit
    return mod

_analysis = _import_analysis_classes()
if _analysis is not None:
    _Config      = getattr(_analysis, 'Config',      None)
    _AlertSystem = getattr(_analysis, 'AlertSystem', None)
else:
    _Config = _AlertSystem = None

# ── Config ────────────────────────────────────────────────────────────────────
API_BASE = "http://localhost:8000"
POLL_INTERVAL = 0.5   # seconds between auto-reruns when "Drive steps" is on


# ── Helpers ───────────────────────────────────────────────────────────────────
def api_get(path: str, params: dict | None = None):
    try:
        r = requests.get(f"{API_BASE}{path}", params=params, timeout=2)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


def api_post(path: str, params: dict | None = None):
    try:
        r = requests.post(f"{API_BASE}{path}", params=params, timeout=2)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


def backend_is_up() -> bool:
    try:
        requests.get(f"{API_BASE}/", timeout=1)
        return True
    except Exception:
        return False


# ── Page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Motor Wear Simulator",
    page_icon="⚙️",
    layout="wide",
)

st.markdown(
    """
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap');
html, body, [class*="css"] { font-family: 'IBM Plex Sans', sans-serif; }
h1, h2, h3                 { font-family: 'IBM Plex Mono', monospace !important; }
.block-container           { padding: 1.5rem 2rem; }

.live-card {
    background: #0d1117;
    border: 1px solid #21262d;
    border-left: 4px solid #f0883e;
    border-radius: 8px;
    padding: 14px 18px;
    text-align: center;
}
.live-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px; color: #8b949e;
    letter-spacing: 0.1em; text-transform: uppercase;
}
.live-value        { font-family:'IBM Plex Mono',monospace; font-size:28px; font-weight:600; color:#f0883e; margin-top:4px; }
.live-value-green  { font-family:'IBM Plex Mono',monospace; font-size:28px; font-weight:600; color:#3fb950; margin-top:4px; }
.live-value-blue   { font-family:'IBM Plex Mono',monospace; font-size:28px; font-weight:600; color:#58a6ff; margin-top:4px; }
.section-header {
    font-family: 'IBM Plex Mono', monospace; font-size: 11px;
    letter-spacing: 0.12em; text-transform: uppercase; color: #8b949e;
    border-bottom: 1px solid #21262d; padding-bottom: 6px; margin: 14px 0 10px 0;
}
.event-tag {
    display: inline-block;
    background: #161b22; border: 1px solid #f0883e;
    border-radius: 4px; padding: 3px 10px; margin: 2px;
    font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #f0883e;
}
.status-running {
    display: inline-block; background: #0f2a0f; border: 1px solid #3fb950;
    border-radius: 20px; padding: 3px 12px;
    font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #3fb950;
}
.status-stopped {
    display: inline-block; background: #2a0f0f; border: 1px solid #f85149;
    border-radius: 20px; padding: 3px 12px;
    font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #f85149;
}
.status-offline {
    display: inline-block; background: #1a1a2e; border: 1px solid #8b949e;
    border-radius: 20px; padding: 3px 12px;
    font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #8b949e;
}
</style>
""",
    unsafe_allow_html=True,
)

# ── Session state defaults ────────────────────────────────────────────────────
st.session_state.setdefault("drive_steps", False)   # whether Streamlit advances steps
st.session_state.setdefault("last_wr_sent", 0.0)    # last wear rate we sent to API
st.session_state.setdefault("motor_current_val", 5.0)
st.session_state.setdefault("k_noise_val", 0.05)
st.session_state.setdefault("wear_rate_val", 0.0)
st.session_state.setdefault("_init_sent", False)    # whether we've pushed UI defaults to API


# ── Fetch current state from FastAPI ─────────────────────────────────────────
online = backend_is_up()
state  = api_get("/api/state") if online else None
hist_data = api_get("/api/history", {"limit": 200}) if online else None
history = hist_data.get("history", []) if hist_data else []
df = pd.DataFrame(history) if history else pd.DataFrame(
    columns=["timestamp","t","I_base","wear_rate","degradation","k_noise","noise","motor_current","cycle_time"]
)
latest = state.get("latest") if state else None

# ── Header ────────────────────────────────────────────────────────────────────
col_title, col_status = st.columns([5, 1])
with col_title:
    st.markdown("# ⚙️ Motor Wear Simulator")
    st.markdown(
        "<p style='color:#8b949e;font-size:13px;margin-top:-12px;'>"
        "Shared simulation — synced with React dashboard via FastAPI</p>",
        unsafe_allow_html=True,
    )
with col_status:
    st.markdown("<div style='height:20px'></div>", unsafe_allow_html=True)
    if not online:
        st.markdown("<div class='status-offline'>⚠ OFFLINE</div>", unsafe_allow_html=True)
    elif state and state.get("t", 0) > 0:
        st.markdown("<div class='status-running'>● RUNNING</div>", unsafe_allow_html=True)
    else:
        st.markdown("<div class='status-stopped'>■ STOPPED</div>", unsafe_allow_html=True)

if not online:
    st.error(
        "⚠️ Cannot reach FastAPI backend at **http://localhost:8000**.\n\n"
        "Please run `start_server.bat` first, then refresh this page."
    )
    st.stop()

st.markdown("---")

# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### Controls")

    # ── Drive-steps toggle ────────────────────────────────────────────────────
    st.markdown('<div class="section-header">Step Driver</div>', unsafe_allow_html=True)
    drive = st.toggle(
        "Drive steps from Streamlit",
        value=st.session_state.drive_steps,
        help=(
            "ON  → Streamlit advances one simulation step per rerun (use when React is closed).\n"
            "OFF → Read-only mirror of the React dashboard (React drives steps)."
        ),
    )
    st.session_state.drive_steps = drive
    if drive:
        st.caption("🟢 Streamlit is advancing the simulation.")
    else:
        st.caption("👁️ Read-only — React drives the steps.")

    st.markdown("---")
    st.markdown('<div class="section-header">Simulation Controls</div>', unsafe_allow_html=True)

    c1, c2 = st.columns(2)
    with c1:
        if st.button("▶ Start / Reset", use_container_width=True, type="primary"):
            api_post("/api/start")
            st.session_state.last_wr_sent = 0.0
            st.session_state.wear_rate_val = 0.0
            st.rerun()
    with c2:
        if st.button("↺ Hard Reset", use_container_width=True):
            api_post("/api/start")
            st.session_state.last_wr_sent = 0.0
            st.session_state.wear_rate_val = 0.0
            st.rerun()

    st.markdown("---")

    # ── Motor current ─────────────────────────────────────────────────────────
    st.caption("Motor current baseline (A)")
    motor_current = st.slider(
        "Motor current baseline (A)",
        min_value=0.0, max_value=20.0, step=0.1,
        value=st.session_state.motor_current_val,  # uses UI default (5.0), not simulator state
        format="%.2f",
        label_visibility="collapsed",
    )
    if motor_current != st.session_state.motor_current_val:
        api_post("/api/set-motor-current", {"value": motor_current})
        st.session_state.motor_current_val = motor_current

    # ── k_noise ───────────────────────────────────────────────────────────────
    st.caption("k_noise (sigma sensitivity)")
    k_noise = st.slider(
        "k_noise (sigma sensitivity)",
        min_value=0.05, max_value=0.25, step=0.05,
        value=st.session_state.k_noise_val,  # uses UI default (0.05), not simulator state (0.25)
        format="%.2f",
        label_visibility="collapsed",
    )
    if k_noise != st.session_state.k_noise_val:
        api_post("/api/set-k-noise", {"value": k_noise})
        st.session_state.k_noise_val = k_noise

    # Push UI defaults to the API once on first load
    if not st.session_state._init_sent:
        api_post("/api/set-motor-current", {"value": st.session_state.motor_current_val})
        api_post("/api/set-k-noise",       {"value": st.session_state.k_noise_val})
        st.session_state._init_sent = True

    st.markdown("---")

    # ── Wear rate interrupt ───────────────────────────────────────────────────
    st.markdown('<div class="section-header">Wear Rate Slider (Interrupt)</div>', unsafe_allow_html=True)
    st.caption(
        "Moving this slider sends an interrupt to the shared simulator. "
        "React will reflect the change on its next poll cycle."
    )
    wear_rate = st.slider(
        "Wear Rate (A / cycle)",
        min_value=0.000, max_value=0.040, step=0.001,
        value=st.session_state.wear_rate_val,
        format="%.3f",
        label_visibility="collapsed",
    )
    if wear_rate != st.session_state.last_wr_sent:
        if state and state.get("t", 0) > 0:
            result = api_post("/api/interrupt", {"rate": wear_rate})
            if result:
                action = result.get("action", "UPDATED")
                if action == "RESET":
                    st.session_state.wear_rate_val = 0.0
                    st.session_state.last_wr_sent = 0.0
                    st.sidebar.success(f"⚡ RESET at t={result.get('current_time')} — wear rate reduced")
                    st.rerun()
                else:
                    st.sidebar.success(
                        f"⚡ Interrupt at t={result.get('current_time')}  "
                        f"Wear rate → {wear_rate:.3f} A/cycle"
                    )
        st.session_state.last_wr_sent = wear_rate
        st.session_state.wear_rate_val = wear_rate

    st.markdown(
        f"<p style='font-family:IBM Plex Mono;font-size:13px;color:#f0883e;margin-top:-6px;'>"
        f"Current: {wear_rate:.3f} A/cycle</p>",
        unsafe_allow_html=True,
    )

    # ── Interrupt events ──────────────────────────────────────────────────────
    st.markdown("---")
    st.markdown('<div class="section-header">Interrupt Events</div>', unsafe_allow_html=True)
    events = state.get("events", []) if state else []
    if events:
        for e in reversed(events):
            st.markdown(
                f"<div class='event-tag'>t={e['time']}  rate={e['new_wear_rate']:.3f}</div>",
                unsafe_allow_html=True,
            )
    else:
        st.caption("No interrupts yet.")

    # ── CSV download ──────────────────────────────────────────────────────────
    st.markdown("---")
    csv_name = st.text_input("CSV filename", value="motor_data.csv")
    if st.button("⬇ Download CSV", use_container_width=True):
        if not df.empty:
            df.to_csv(csv_name, index=False)
            st.success(f"Saved → {csv_name}")
        else:
            st.warning("No data yet — start the simulation first.")

# ── Advance one step (if Streamlit is the driver) ─────────────────────────────
if st.session_state.drive_steps:
    api_get("/api/step")
    # Refresh state + history after stepping
    state     = api_get("/api/state") or state
    hist_data = api_get("/api/history", {"limit": 200}) or hist_data
    history   = hist_data.get("history", []) if hist_data else []
    df        = pd.DataFrame(history) if history else df
    latest    = state.get("latest") if state else latest

# ── Live metrics ──────────────────────────────────────────────────────────────
m1, m2, m3, m4, m5, m6 = st.columns(6)

def metric_card(col, label, value, style="live-value"):
    with col:
        st.markdown(
            f'<div class="live-card">'
            f'<div class="live-label">{label}</div>'
            f'<div class="{style}">{value}</div>'
            f'</div>',
            unsafe_allow_html=True,
        )

metric_card(m1, "⏱ Current Time (t)",  str(int(latest["t"])) if latest else "—", "live-value-green")
metric_card(m2, "⚡ Motor Current",     f"{latest['motor_current']:.3f} A" if latest else "—")
metric_card(m3, "🔋 I_base",            f"{latest['I_base']:.3f} A" if latest else "—", "live-value-green")
metric_card(m4, "🔧 Wear Rate",         f"{latest['wear_rate']:.4f}" if latest else "—", "live-value-blue")
metric_card(m5, "📉 Degradation",       f"{latest['degradation']:.4f} A" if latest else "—")
metric_card(m6, "🕐 Cycle Time",        f"{latest['cycle_time']:.3f} s" if latest else "—", "live-value-blue")

# ── Interrupt events table ────────────────────────────────────────────────────
all_events = api_get("/api/events") if online else None
all_events_list = all_events.get("events", []) if all_events else []
if all_events_list:
    st.markdown('<div class="section-header">Interrupt Log</div>', unsafe_allow_html=True)
    event_df = pd.DataFrame(all_events_list).rename(columns={
        "timestamp": "Timestamp",
        "time": "Time (t)",
        "new_wear_rate": "New Wear Rate",
        "I_base_noted": "I_base noted",
        "action": "Action",
    })
    event_cols = ["Timestamp", "Time (t)", "New Wear Rate", "I_base noted"]
    if "Action" in event_df.columns:
        event_cols.append("Action")
    st.dataframe(event_df[event_cols], use_container_width=True, hide_index=True)
    st.caption("I_base noted = motor current at the exact moment of the interrupt.")

st.markdown("---")

# ── Live charts ───────────────────────────────────────────────────────────────
if len(df) > 1:
    tab1, tab2, tab3, tab4 = st.tabs(["📈 Motor Current", "⏱ Cycle Time", "🗂 Live Data Table", "📊 Live Analysis"])

    with tab1:
        st.markdown('<div class="section-header">Motor Current and Degradation</div>', unsafe_allow_html=True)
        if all_events_list:
            st.caption("Wear rate changed at: " + "   ".join(
                [f"t={e['time']} → {e['new_wear_rate']:.3f}" for e in all_events_list]
            ))
        st.line_chart(df[["t", "motor_current", "degradation"]].set_index("t"), color=["#f0883e", "#58a6ff"])
        st.caption("🟠 motor_current     🔵 degradation")

    with tab2:
        st.markdown('<div class="section-header">Cycle Time</div>', unsafe_allow_html=True)
        st.line_chart(df[["t", "cycle_time"]].set_index("t"), color=["#3fb950"])

    with tab3:
        st.markdown('<div class="section-header">Live Data (last 50 rows)</div>', unsafe_allow_html=True)
        st.dataframe(df.tail(50), use_container_width=True, hide_index=True)

    # ── Tab 4: Live EWMA Analysis ─────────────────────────────────────────────
    with tab4:
        st.markdown('<div class="section-header">EWMA Control Chart — Real-time Alert Analysis</div>', unsafe_allow_html=True)

        if _Config is None or _AlertSystem is None:
            st.error("Could not load analysis.py classes. Check the file exists in the backend folder.")
        else:
            cfg = _Config()  # default parameters matching the simulator

            # Run EWMA pipeline over the full history
            analysis_df = df[["t", "motor_current", "cycle_time"]].copy()
            analysis_df = analysis_df.sort_values("t").reset_index(drop=True)
            analysis_df["motor_current"] = pd.to_numeric(analysis_df["motor_current"], errors="coerce")

            alert_sys = _AlertSystem(cfg)
            ewma_vals = [
                alert_sys.process(int(row.t), float(row.motor_current))
                for row in analysis_df.itertuples()
            ]
            analysis_df["ewma"] = ewma_vals

            # ── Plotly figure ────────────────────────────────────────────────
            fig = go.Figure()

            # Raw current (faint)
            fig.add_trace(go.Scatter(
                x=analysis_df["t"], y=analysis_df["motor_current"],
                mode="lines", name="Raw Current",
                line=dict(color="#58a6ff", width=1),
                opacity=0.35,
            ))

            # EWMA line
            fig.add_trace(go.Scatter(
                x=analysis_df["t"], y=analysis_df["ewma"],
                mode="lines", name="EWMA",
                line=dict(color="royalblue", width=2.5),
            ))

            # Control limits
            t_range = [analysis_df["t"].min(), analysis_df["t"].max()]
            fig.add_trace(go.Scatter(
                x=t_range, y=[cfg.MU, cfg.MU],
                mode="lines", name=f"Mean ({cfg.MU} A)",
                line=dict(color="gray", dash="dash", width=1),
            ))
            fig.add_trace(go.Scatter(
                x=t_range, y=[cfg.UCL_2SIGMA, cfg.UCL_2SIGMA],
                mode="lines", name=f"UCL 2σ ({cfg.UCL_2SIGMA:.2f} A)",
                line=dict(color="orange", dash="dash", width=1.5),
            ))
            fig.add_trace(go.Scatter(
                x=t_range, y=[cfg.UCL_3SIGMA, cfg.UCL_3SIGMA],
                mode="lines", name=f"UCL 3σ ({cfg.UCL_3SIGMA:.2f} A)",
                line=dict(color="red", dash="dash", width=1.5),
            ))

            # Interrupt event vertical lines
            for ev in all_events_list:
                ev_t = ev.get("time", 0)
                color = "#d62728" if ev.get("action") == "RESET" else "#9467bd"
                fig.add_vline(
                    x=ev_t, line_color=color, line_dash="dot", line_width=1.5,
                    annotation_text=f"wr={ev.get('new_wear_rate', 0):.3f}",
                    annotation_font_size=10, annotation_font_color=color,
                )

            # Alert markers — first trigger per tier
            alert_styles = {
                "early": dict(color="green",  symbol="triangle-up", size=14, label="First EARLY alert"),
                "mid":   dict(color="orange", symbol="diamond",     size=14, label="First MID alert"),
                "late":  dict(color="red",    symbol="x",           size=16, label="First LATE alert"),
            }
            for tier, times in alert_sys.alerts.items():
                if times:
                    first_t = times[0]
                    row = analysis_df[analysis_df["t"] == first_t]
                    if not row.empty:
                        s = alert_styles[tier]
                        fig.add_trace(go.Scatter(
                            x=[first_t], y=[row["ewma"].values[0]],
                            mode="markers",
                            name=s["label"],
                            marker=dict(color=s["color"], symbol=s["symbol"], size=s["size"], line=dict(width=2, color="white")),
                        ))

            fig.update_layout(
                template="plotly_dark",
                paper_bgcolor="#0d1117",
                plot_bgcolor="#0d1117",
                height=450,
                margin=dict(l=50, r=30, t=40, b=50),
                xaxis=dict(title="Simulation cycle (t)", gridcolor="#21262d"),
                yaxis=dict(title="Motor Current (A)",    gridcolor="#21262d"),
                legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
                hovermode="x unified",
            )
            st.plotly_chart(fig, use_container_width=True)

            # ── Alert summary cards ──────────────────────────────────────────
            a1, a2, a3 = st.columns(3)
            tier_info = [
                ("EARLY", "early", "#3fb950"),
                ("MID",   "mid",   "#f0883e"),
                ("LATE",  "late",  "#f85149"),
            ]
            for col, (label, key, color) in zip([a1, a2, a3], tier_info):
                times = alert_sys.alerts[key]
                count = len(times)
                first = f"t={times[0]}" if times else "None yet"
                with col:
                    st.markdown(
                        f'<div class="live-card" style="border-left-color:{color};">'
                        f'<div class="live-label">{label} alerts</div>'
                        f'<div class="live-value" style="color:{color};font-size:22px;">{count}</div>'
                        f'<div class="live-label">First trigger: {first}</div>'
                        f'</div>',
                        unsafe_allow_html=True,
                    )

            # Show EWMA config being used
            with st.expander("⚙️ EWMA Config"):
                st.json({
                    "MU (healthy mean)": cfg.MU,
                    "SIGMA": cfg.SIGMA,
                    "UCL_2sigma": cfg.UCL_2SIGMA,
                    "UCL_3sigma": cfg.UCL_3SIGMA,
                    "alpha (EWMA smoothing)": cfg.alpha,
                    "S_EARLY slope threshold": cfg.S_EARLY,
                    "S_MID slope threshold": cfg.S_MID,
                    "S_LATE slope threshold": cfg.S_LATE,
                })
else:
    st.info("▶ Press **Start / Reset** in the sidebar (or use the React dashboard) to begin the simulation.")


# ── CSV save ──────────────────────────────────────────────────────────────────
if len(df) > 0:
    st.markdown("---")
    if st.button("⬇ Save Full CSV Snapshot", use_container_width=True):
        import os
        snapshot_path = os.path.join(os.path.dirname(__file__), csv_name)
        df.to_csv(snapshot_path, index=False)
        st.success(f"Saved → {snapshot_path}")

# ── Auto-rerun loop ───────────────────────────────────────────────────────────
# When "drive_steps" is ON, sleep briefly then rerun to keep advancing the sim.
# When OFF, still rerun periodically so the display stays fresh as React drives steps.
refresh_interval = POLL_INTERVAL if st.session_state.drive_steps else 1.0
time_module.sleep(refresh_interval)
st.rerun()
