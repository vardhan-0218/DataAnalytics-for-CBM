"""
app.py — Streamlit CBM Dashboard for the Food-Processing Pulveriser.

Uses the new synthetic /api/synthetic/* endpoints exclusively.
Provides Signal Type + Fault Mode radio buttons that control what the
simulator generates; all changes reflect in real-time charts.
"""

import time as _time
import requests
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

# ── Config ─────────────────────────────────────────────────────────────────────
API_BASE      = "http://localhost:8000"
POLL_INTERVAL = 1.0   # seconds between auto-reruns


# ── API helpers ────────────────────────────────────────────────────────────────
def api_get(path: str, params: dict | None = None):
    try:
        r = requests.get(f"{API_BASE}{path}", params=params, timeout=3)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


def api_post(path: str, params: dict | None = None, json: dict | None = None):
    try:
        r = requests.post(f"{API_BASE}{path}", params=params, json=json, timeout=3)
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


# ── Page config ────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Pulveriser CBM — Real-Time Dashboard",
    page_icon="⚙️",
    layout="wide",
)

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap');
html, body, [class*="css"] { font-family: 'IBM Plex Sans', sans-serif; background: #0d1117; color: #e6edf3; }
h1, h2, h3 { font-family: 'IBM Plex Mono', monospace !important; }
.block-container { padding: 1.2rem 1.5rem; }

.kpi-card {
    background: #161b22; border: 1px solid #30363d;
    border-radius: 8px; padding: 14px 16px; text-align: center;
}
.kpi-label { font-family: 'IBM Plex Mono'; font-size: 10px; color: #8b949e;
             letter-spacing: 0.1em; text-transform: uppercase; }
.kpi-val   { font-family: 'IBM Plex Mono'; font-size: 26px; font-weight: 600; margin-top: 4px; }
.kpi-unit  { font-family: 'IBM Plex Mono'; font-size: 11px; color: #8b949e; }

.alarm-normal   { background:#0f2a0f; border:1px solid #3fb950; border-radius:6px; padding:8px 14px; color:#3fb950; font-family:'IBM Plex Mono'; font-size:13px; }
.alarm-early    { background:#1a2a0f; border:1px solid #d29922; border-radius:6px; padding:8px 14px; color:#d29922; font-family:'IBM Plex Mono'; font-size:13px; }
.alarm-mid      { background:#2a1a0f; border:1px solid #f0883e; border-radius:6px; padding:8px 14px; color:#f0883e; font-family:'IBM Plex Mono'; font-size:13px; }
.alarm-late     { background:#2a0f0f; border:1px solid #f85149; border-radius:6px; padding:8px 14px; color:#f85149; font-family:'IBM Plex Mono'; font-size:13px; }

.section-hdr { font-family:'IBM Plex Mono'; font-size:10px; letter-spacing:0.12em;
               text-transform:uppercase; color:#8b949e;
               border-bottom:1px solid #21262d; padding-bottom:5px; margin:12px 0 8px; }

.radio-opt { display:flex; align-items:center; gap:8px; padding:6px 10px;
             border-radius:6px; cursor:pointer; border:1px solid transparent; margin-bottom:4px; }
.radio-opt-active { border-color: #388bfd33; background: #1c2d4a; }
</style>
""", unsafe_allow_html=True)

# ── Session state ──────────────────────────────────────────────────────────────
st.session_state.setdefault("signal_type",  "vibration")   # vibration | current | temperature
st.session_state.setdefault("vib_mode",     "healthy")
st.session_state.setdefault("vib_sev",      0.50)
st.session_state.setdefault("cur_mode",     "healthy")
st.session_state.setdefault("cur_sev",      0.50)
st.session_state.setdefault("temp_mode",    "healthy")
st.session_state.setdefault("temp_sev",     0.50)
st.session_state.setdefault("live",         True)

# ── Backend check ──────────────────────────────────────────────────────────────
online = backend_is_up()

if online:
    # Sync with backend configuration (two-way synchronization with React UI)
    status = api_get("/api/synthetic/status")
    if status and "severity" in status:
        sev_data = status["severity"]
        
        backend_vib_mode = "bearing" if sev_data.get("vib_bearing_fault", 0.0) > 0.0 else "blade" if sev_data.get("vib_blade_wear", 0.0) > 0.0 else "healthy"
        backend_vib_sev = sev_data.get("vib_bearing_fault", 0.0) if backend_vib_mode == "bearing" else sev_data.get("vib_blade_wear", 0.0) if backend_vib_mode == "blade" else 0.50
        
        backend_cur_mode = "bearing" if sev_data.get("cur_bearing_fault", 0.0) > 0.0 else "blade" if sev_data.get("cur_blade_wear", 0.0) > 0.0 else "healthy"
        backend_cur_sev = sev_data.get("cur_bearing_fault", 0.0) if backend_cur_mode == "bearing" else sev_data.get("cur_blade_wear", 0.0) if backend_cur_mode == "blade" else 0.50
        
        backend_temp_mode = "bearing" if sev_data.get("temp_bearing_fault", 0.0) > 0.0 else "blade" if sev_data.get("temp_blade_wear", 0.0) > 0.0 else "healthy"
        backend_temp_sev = sev_data.get("temp_bearing_fault", 0.0) if backend_temp_mode == "bearing" else sev_data.get("temp_blade_wear", 0.0) if backend_temp_mode == "blade" else 0.50

        backend_key = f"{backend_vib_mode}:{backend_vib_sev:.2f}:{backend_cur_mode}:{backend_cur_sev:.2f}:{backend_temp_mode}:{backend_temp_sev:.2f}"
        
        if "applied_config" not in st.session_state:
            st.session_state.applied_config = backend_key
            st.session_state.vib_mode = backend_vib_mode
            st.session_state.vib_sev = backend_vib_sev
            st.session_state.cur_mode = backend_cur_mode
            st.session_state.cur_sev = backend_cur_sev
            st.session_state.temp_mode = backend_temp_mode
            st.session_state.temp_sev = backend_temp_sev

        if backend_key != st.session_state.applied_config:
            st.session_state.vib_mode = backend_vib_mode
            st.session_state.vib_sev = backend_vib_sev
            st.session_state.cur_mode = backend_cur_mode
            st.session_state.cur_sev = backend_cur_sev
            st.session_state.temp_mode = backend_temp_mode
            st.session_state.temp_sev = backend_temp_sev
            st.session_state.applied_config = backend_key
            st.rerun()

# ── Header ─────────────────────────────────────────────────────────────────────
col_title, col_status = st.columns([5, 1])
with col_title:
    st.markdown("# ⚙️ Pulveriser CBM — Real-Time Dashboard")
    st.markdown("<p style='color:#8b949e;font-size:13px;margin-top:-10px;'>"
                "Synthetic Data Generator · Stage-1 · Condition-Based Monitoring</p>",
                unsafe_allow_html=True)
with col_status:
    st.markdown("<div style='height:16px'></div>", unsafe_allow_html=True)
    if not online:
        st.markdown("<span style='background:#2a0f0f;border:1px solid #f85149;border-radius:20px;"
                    "padding:3px 12px;font-family:IBM Plex Mono;font-size:12px;color:#f85149'>⚠ OFFLINE</span>",
                    unsafe_allow_html=True)
    else:
        st.markdown("<span style='background:#0f2a0f;border:1px solid #3fb950;border-radius:20px;"
                    "padding:3px 12px;font-family:IBM Plex Mono;font-size:12px;color:#3fb950'>● LIVE</span>",
                    unsafe_allow_html=True)

if not online:
    st.error("⚠️ Cannot reach FastAPI backend at **http://localhost:8000**.\n\n"
             "Run:\n```\ncd backend\npython -m uvicorn main_server:app --reload --port 8000\n```")
    st.stop()

# ── SIDEBAR — Signal Type + Fault Mode controls ────────────────────────────────
with st.sidebar:
    st.markdown("### 🔗 Links")
    st.markdown('<a href="http://localhost:5173" target="_blank" style="display:inline-block;padding:8px 16px;background-color:#1f6feb;color:white;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;text-align:center;width:100%;">🔗 Open React UI Panel</a>', unsafe_allow_html=True)
    st.markdown("---")

    st.markdown("### 🎛 Fault Controls")

    # ── VIBRATION FAULT ───────────────────────────────────────────────────────
    st.markdown('<div class="section-hdr" style="color:#58a6ff;border-color:#58a6ff33;margin-top:16px;">〰️ Vibration Fault</div>', unsafe_allow_html=True)
    vib_mode = st.radio(
        "Vibration Fault Mode",
        options=["healthy", "bearing", "blade"],
        format_func=lambda x: {"healthy": "✅ Healthy", "bearing": "⚙️ Bearing Fault", "blade": "🔧 Blade Wear"}[x],
        index=["healthy","bearing","blade"].index(st.session_state.vib_mode),
        key="vib_mode_widget",
        label_visibility="collapsed",
    )
    
    vib_sev = st.session_state.vib_sev
    if vib_mode != "healthy":
        st.markdown('<div style="font-size:11px;color:#8b949e;margin-top:4px;">Severity</div>', unsafe_allow_html=True)
        vib_sev = st.slider(
            "Vibration Severity", min_value=0.0, max_value=1.0, step=0.05,
            value=st.session_state.vib_sev,
            format="%.2f", label_visibility="collapsed",
            key="vib_sev_widget"
        )

    # ── MOTOR CURRENT FAULT ───────────────────────────────────────────────────
    st.markdown('<div class="section-hdr" style="color:#f0883e;border-color:#f0883e33;margin-top:16px;">⚡ Motor Current Fault</div>', unsafe_allow_html=True)
    cur_mode = st.radio(
        "Motor Current Fault Mode",
        options=["healthy", "bearing", "blade"],
        format_func=lambda x: {"healthy": "✅ Healthy", "bearing": "⚙️ Bearing Fault", "blade": "🔧 Blade Wear"}[x],
        index=["healthy","bearing","blade"].index(st.session_state.cur_mode),
        key="cur_mode_widget",
        label_visibility="collapsed",
    )
    
    cur_sev = st.session_state.cur_sev
    if cur_mode != "healthy":
        st.markdown('<div style="font-size:11px;color:#8b949e;margin-top:4px;">Severity</div>', unsafe_allow_html=True)
        cur_sev = st.slider(
            "Motor Current Severity", min_value=0.0, max_value=1.0, step=0.05,
            value=st.session_state.cur_sev,
            format="%.2f", label_visibility="collapsed",
            key="cur_sev_widget"
        )

    # ── TEMPERATURE FAULT ─────────────────────────────────────────────────────
    st.markdown('<div class="section-hdr" style="color:#3fb950;border-color:#3fb95033;margin-top:16px;">🌡️ Temperature Fault</div>', unsafe_allow_html=True)
    temp_mode = st.radio(
        "Temperature Fault Mode",
        options=["healthy", "bearing", "blade"],
        format_func=lambda x: {"healthy": "✅ Healthy", "bearing": "⚙️ Bearing Fault", "blade": "🔧 Blade Wear"}[x],
        index=["healthy","bearing","blade"].index(st.session_state.temp_mode),
        key="temp_mode_widget",
        label_visibility="collapsed",
    )
    
    temp_sev = st.session_state.temp_sev
    if temp_mode != "healthy":
        st.markdown('<div style="font-size:11px;color:#8b949e;margin-top:4px;">Severity</div>', unsafe_allow_html=True)
        temp_sev = st.slider(
            "Temperature Severity", min_value=0.0, max_value=1.0, step=0.05,
            value=st.session_state.temp_sev,
            format="%.2f", label_visibility="collapsed",
            key="temp_sev_widget"
        )

    # ── Detect user updates & POST to backend ──────────────────────────────────
    user_key = f"{vib_mode}:{vib_sev:.2f}:{cur_mode}:{cur_sev:.2f}:{temp_mode}:{temp_sev:.2f}"
    if user_key != st.session_state.applied_config:
        st.session_state.vib_mode = vib_mode
        st.session_state.vib_sev = vib_sev
        st.session_state.cur_mode = cur_mode
        st.session_state.cur_sev = cur_sev
        st.session_state.temp_mode = temp_mode
        st.session_state.temp_sev = temp_sev
        st.session_state.applied_config = user_key
        
        vib_bearing_payload = vib_sev if vib_mode == 'bearing' else 0.0
        vib_blade_payload   = vib_sev if vib_mode == 'blade' else 0.0
        
        cur_bearing_payload = cur_sev if cur_mode == 'bearing' else 0.0
        cur_blade_payload   = cur_sev if cur_mode == 'blade' else 0.0
        
        temp_bearing_payload = temp_sev if temp_mode == 'bearing' else 0.0
        temp_blade_payload   = temp_sev if temp_mode == 'blade' else 0.0
        
        api_post("/api/synthetic/configure", json={
            "severity": {
                "vib_bearing_fault": vib_bearing_payload,
                "vib_blade_wear":    vib_blade_payload,
                "cur_bearing_fault": cur_bearing_payload,
                "cur_blade_wear":    cur_blade_payload,
                "temp_bearing_fault":temp_bearing_payload,
                "temp_blade_wear":   temp_blade_payload,
                "bearing_fault": max(vib_bearing_payload, cur_bearing_payload, temp_bearing_payload),
                "blade_wear":    max(vib_blade_payload, cur_blade_payload, temp_blade_payload)
            },
            "load_ratio": 0.70
        })
        st.rerun()

    st.markdown("---")

    # ── Simulation controls ───────────────────────────────────────────────────
    st.markdown('<div class="section-hdr">Simulation</div>', unsafe_allow_html=True)
    col1, col2 = st.columns(2)
    with col1:
        if st.button("▶ Start Live", use_container_width=True, type="primary"):
            st.session_state.live = True
    with col2:
        if st.button("⏸ Pause", use_container_width=True):
            st.session_state.live = False

    if st.button("↺ Reset Simulator", use_container_width=True):
        api_post("/api/synthetic/reset")
        st.success("Simulator reset")
        st.rerun()

    st.markdown("---")
    st.caption(f"**Window mode:** {'🟢 LIVE' if st.session_state.live else '⏸ PAUSED'}")
    status = api_get("/api/synthetic/status")
    if status:
        st.caption(f"Windows generated: **{status.get('window_idx',0)}**")
        st.caption(f"DB connected: **{'✅' if status.get('db_connected') else '❌'}**")

    # ── CSV Export ────────────────────────────────────────────────────────────
    st.markdown("---")
    st.markdown('<div class="section-hdr">Export Data</div>', unsafe_allow_html=True)
    
    if st.button("⬇ Download 1s Raw Signal Data (CSV)", use_container_width=True):
        try:
            r = requests.get(f"{API_BASE}/api/synthetic/download_raw_csv", timeout=10)
            r.raise_for_status()
            st.download_button(
                "📥 Save pulveriser_raw_1s_data.csv",
                r.content,
                "pulveriser_raw_1s_data.csv",
                "text/csv"
            )
        except Exception as e:
            st.error(f"Failed to fetch raw CSV data: {e}")



# ── Fetch latest window ────────────────────────────────────────────────────────
health_data = api_get("/api/synthetic/health")

# ── Fetch history for charts ───────────────────────────────────────────────────
hist_resp = api_get("/api/synthetic/history", {"limit": 150})
history   = hist_resp.get("history", []) if hist_resp else []
df        = pd.DataFrame(history) if history else pd.DataFrame()

latest = health_data  # shorthand


# ── ALARM BANNER ──────────────────────────────────────────────────────────────
if latest:
    alarm_sev = latest.get("alarms", {}).get("severity", "NORMAL")
    alarm_cls = {"NORMAL":"alarm-normal","EARLY":"alarm-early",
                 "MID":"alarm-mid","LATE":"alarm-late"}.get(alarm_sev, "alarm-normal")
    alarm_icons = {"NORMAL":"✅","EARLY":"⚠️","MID":"🔶","LATE":"🚨"}
    alarm_msg   = {
        "NORMAL": "All health indices within normal range",
        "EARLY":  "Predictive warning — schedule maintenance soon",
        "MID":    "Increased monitoring required",
        "LATE":   "Critical — immediate action required!",
    }
    st.markdown(
        f'<div class="{alarm_cls}">'
        f'{alarm_icons.get(alarm_sev,"⚙")} <strong>{alarm_sev}</strong> — '
        f'{alarm_msg.get(alarm_sev,"")} '
        f'&nbsp;&nbsp;|&nbsp;&nbsp; Min Health Index: '
        f'<strong>{latest["alarms"].get("min_index", 0):.1f}</strong>'
        f'</div>',
        unsafe_allow_html=True,
    )
    st.markdown("<div style='height:10px'></div>", unsafe_allow_html=True)


# ── KPI ROW ───────────────────────────────────────────────────────────────────
def kpi(col, label, value, unit, color="#f0883e"):
    with col:
        st.markdown(
            f'<div class="kpi-card">'
            f'<div class="kpi-label">{label}</div>'
            f'<div class="kpi-val" style="color:{color}">{value}</div>'
            f'<div class="kpi-unit">{unit}</div>'
            f'</div>',
            unsafe_allow_html=True,
        )

kpi_data = latest.get("kpis",    {}) if latest else {}
idx_data = latest.get("indices", {}) if latest else {}

k1,k2,k3,k4,k5,k6,k7 = st.columns(7)
kpi(k1, "MHI",        f"{idx_data.get('MHI', 0):.1f}",          "/100",    "#58a6ff")
kpi(k2, "PQI",        f"{idx_data.get('PQI', 0):.1f}",          "/100",    "#79c0ff")
kpi(k3, "GQI",        f"{idx_data.get('GQI', 0):.1f}",          "/100",    "#a5d6ff")
kpi(k4, "Cycle Time", f"{kpi_data.get('CycleTime', 0):.1f}",    "seconds", "#3fb950")
kpi(k5, "Throughput", f"{kpi_data.get('Throughput', 0):.1f}",   "kg/hr",   "#3fb950")
kpi(k6, "Grind Eff.", f"{kpi_data.get('GrindingEfficiency',0)*100:.1f}", "%", "#d29922")
kpi(k7, "Load Ratio", f"{kpi_data.get('LoadRatio', 0):.2f}",    "λ",       "#f0883e")

st.markdown("<div style='height:12px'></div>", unsafe_allow_html=True)


# ── FEATURE ROW ───────────────────────────────────────────────────────────────
feat_all = latest.get("features", {}) if latest else {}
feat_vib = feat_all.get("vibration",   {})
feat_cur = feat_all.get("current",     {})
feat_tmp = feat_all.get("temperature", {})

st.markdown('<div class="section-hdr">Signal Features — Current Window</div>', unsafe_allow_html=True)
f1,f2,f3,f4,f5,f6,f7,f8,f9 = st.columns(9)

def feat_kpi(col, label, value, color="#e6edf3"):
    fmt = f"{value:.4f}" if value is not None else "—"
    with col:
        st.markdown(
            f'<div class="kpi-card" style="padding:10px 8px">'
            f'<div class="kpi-label">{label}</div>'
            f'<div class="kpi-val" style="color:{color};font-size:18px">{fmt}</div>'
            f'</div>',
            unsafe_allow_html=True,
        )

feat_kpi(f1, "Vib RMS",    feat_vib.get("RMS"),              "#58a6ff")
feat_kpi(f2, "Kurtosis",   feat_vib.get("Kurtosis"),         "#58a6ff")
feat_kpi(f3, "Crest Fac.", feat_vib.get("CrestFactor"),      "#58a6ff")
feat_kpi(f4, "Spec. Cen.", feat_vib.get("SpectralCentroid"), "#58a6ff")
feat_kpi(f5, "THD (vib)",  feat_vib.get("THD"),              "#58a6ff")
feat_kpi(f6, "Cur RMS",    feat_cur.get("RMS"),              "#f0883e")
feat_kpi(f7, "Cur Kurt.",  feat_cur.get("Kurtosis"),         "#f0883e")
feat_kpi(f8, "Temp Mean",  feat_tmp.get("Mean"),             "#3fb950")
feat_kpi(f9, "Temp RoC",   feat_tmp.get("RateOfChange"),     "#3fb950")

st.markdown("<div style='height:12px'></div>", unsafe_allow_html=True)


# ── CHARTS ────────────────────────────────────────────────────────────────────
tab1, tab2, tab3, tab4 = st.tabs([
    "📊 Health Indices",
    "🔧 Signal Features",
    "⚡ KPIs",
    "🗂 Data Table",
])

PLOT_LAYOUT = dict(
    template="plotly_dark",
    paper_bgcolor="#0d1117",
    plot_bgcolor="#0d1117",
    height=350,
    margin=dict(l=50, r=20, t=30, b=40),
    xaxis=dict(title="Window #", gridcolor="#21262d"),
    legend=dict(orientation="h", yanchor="bottom", y=1.02),
)

if not df.empty and "window_idx" in df.columns:
    x = df["window_idx"]

    with tab1:
        st.markdown('<div class="section-hdr">Health Indices — MHI / PQI / GQI</div>',
                    unsafe_allow_html=True)
        fig = go.Figure()
        for col, color, label in [("MHI","#58a6ff","MHI"),("PQI","#3fb950","PQI"),("GQI","#f0883e","GQI")]:
            if col in df.columns:
                fig.add_trace(go.Scatter(x=x, y=df[col], name=label,
                                         line=dict(color=color, width=2)))
        # Threshold lines
        fig.add_hline(y=85, line_dash="dot", line_color="#3fb950", annotation_text="Healthy 85")
        fig.add_hline(y=70, line_dash="dot", line_color="#d29922", annotation_text="Warning 70")
        fig.update_layout(**PLOT_LAYOUT, yaxis=dict(title="Index (0-100)", gridcolor="#21262d", range=[0,105]))
        st.plotly_chart(fig, use_container_width=True)

        # Alarm severity distribution
        if "alarm_severity" in df.columns:
            alarm_counts = df["alarm_severity"].value_counts()
            a1,a2,a3,a4 = st.columns(4)
            cols = {"NORMAL": (a1,"#3fb950"), "EARLY": (a2,"#d29922"),
                    "MID": (a3,"#f0883e"), "LATE": (a4,"#f85149")}
            for name, (c, color) in cols.items():
                count = int(alarm_counts.get(name, 0))
                with c:
                    st.markdown(
                        f'<div class="kpi-card" style="border-top:3px solid {color}">'
                        f'<div class="kpi-label">{name} alarms</div>'
                        f'<div class="kpi-val" style="color:{color};font-size:22px">{count}</div>'
                        f'</div>',
                        unsafe_allow_html=True,
                    )

    with tab2:
        st.markdown('<div class="section-hdr">Vibration Features Over Time</div>', unsafe_allow_html=True)
        fig2 = go.Figure()
        for col, color, label in [
            ("vib_RMS","#58a6ff","Vib RMS"),
            ("vib_Kurtosis","#f0883e","Kurtosis"),
            ("vib_CrestFactor","#3fb950","Crest Factor"),
        ]:
            if col in df.columns:
                fig2.add_trace(go.Scatter(x=x, y=df[col], name=label, line=dict(color=color, width=2)))
        fig2.update_layout(**PLOT_LAYOUT, yaxis=dict(title="Feature Value", gridcolor="#21262d"))
        st.plotly_chart(fig2, use_container_width=True)

        st.markdown('<div class="section-hdr">Current & Temperature Features</div>', unsafe_allow_html=True)
        fig3 = go.Figure()
        for col, color, label in [
            ("cur_RMS","#f0883e","Current RMS (A)"),
            ("temp_Mean","#3fb950","Temperature Mean (°C)"),
        ]:
            if col in df.columns:
                fig3.add_trace(go.Scatter(x=x, y=df[col], name=label, line=dict(color=color, width=2)))
        fig3.update_layout(**PLOT_LAYOUT, yaxis=dict(title="Value", gridcolor="#21262d"))
        st.plotly_chart(fig3, use_container_width=True)

    with tab3:
        st.markdown('<div class="section-hdr">Process KPIs Over Time</div>', unsafe_allow_html=True)
        fig4 = go.Figure()
        for col, color, label in [
            ("CycleTime","#3fb950","Cycle Time (s)"),
            ("Throughput","#58a6ff","Throughput (kg/hr)"),
        ]:
            if col in df.columns:
                fig4.add_trace(go.Scatter(x=x, y=df[col], name=label, line=dict(color=color, width=2)))
        fig4.update_layout(**PLOT_LAYOUT, yaxis=dict(title="Value", gridcolor="#21262d"))
        st.plotly_chart(fig4, use_container_width=True)

        if "GrindingEfficiency" in df.columns:
            fig5 = go.Figure()
            fig5.add_trace(go.Scatter(x=x, y=df["GrindingEfficiency"]*100,
                                      name="Grinding Efficiency (%)", line=dict(color="#d29922", width=2)))
            fig5.update_layout(**PLOT_LAYOUT, yaxis=dict(title="Efficiency (%)", gridcolor="#21262d"))
            st.plotly_chart(fig5, use_container_width=True)

    with tab4:
        st.markdown('<div class="section-hdr">All Data Fields — Last 50 Windows</div>',
                    unsafe_allow_html=True)
        # Show all columns with readable names
        display_cols = [c for c in df.columns if c in [
            "window_idx","timestamp","alarm_severity",
            "MHI","PQI","GQI","min_index",
            "CycleTime","Throughput","GrindingEfficiency","LoadRatio",
            "vib_RMS","vib_Kurtosis","vib_CrestFactor","vib_SpectralCentroid","vib_THD",
            "cur_RMS","cur_Kurtosis","cur_THD",
            "temp_Mean","temp_RMS","temp_RateOfChange",
            "severity_bearing","severity_blade",
        ]]
        st.dataframe(df[display_cols].tail(50), use_container_width=True, hide_index=True)

        # Signal + fault mode badges
        st.info(
            f"**Vib:** {st.session_state.vib_mode.upper()} ({st.session_state.vib_sev:.2f})  |  "
            f"**Cur:** {st.session_state.cur_mode.upper()} ({st.session_state.cur_sev:.2f})  |  "
            f"**Temp:** {st.session_state.temp_mode.upper()} ({st.session_state.temp_sev:.2f})"
        )
else:
    for tab in [tab1, tab2, tab3, tab4]:
        with tab:
            st.info("▶ Data will appear here. Make sure the backend is running and generating windows.")


# ── Auto-rerun ─────────────────────────────────────────────────────────────────
if st.session_state.live:
    _time.sleep(POLL_INTERVAL)
    st.rerun()
