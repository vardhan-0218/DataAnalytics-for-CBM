"""
main.py — CLI for the Pulveriser Digital Twin Synthetic Data Generator.

Usage examples::

    # Healthy baseline, 10 windows, JSON output
    python main.py --condition healthy --windows 10 --output data.json

    # Bearing fault at moderate severity, 30 windows
    python main.py --condition bearing --severity moderate --windows 30

    # Combined blade wear + partial clogging
    python main.py --condition combined --blade-wear 0.5 --partial-clogging 0.5

    # All faults at severe level, CSV output
    python main.py --condition all --severity severe --output data.csv --format csv

    # Load custom config
    python main.py --config my_config.json --windows 20
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Allow running as: python -m synthetic.main (from backend/) or directly
try:
    from synthetic.config import load_config, PulveriserConfig, SeverityConfig
    from synthetic.simulator import PulveriserSimulator
except ImportError:
    from config import load_config, PulveriserConfig, SeverityConfig  # type: ignore
    from simulator import PulveriserSimulator  # type: ignore


# ---------------------------------------------------------------------------
# Preset condition → severity mappings
# ---------------------------------------------------------------------------

SEVERITY_LEVEL_MAP = {
    "healthy":   0.00,
    "very_mild": 0.10,
    "mild":      0.25,
    "moderate":  0.50,
    "severe":    0.75,
    "critical":  1.00,
}

CONDITION_PRESETS: Dict[str, Dict[str, float]] = {
    "healthy": {
        "blade_wear": 0.0, "bearing_fault": 0.0, "imbalance": 0.0,
        "misalignment": 0.0, "looseness": 0.0, "material_buildup": 0.0,
        "partial_clogging": 0.0, "choking": 0.0,
    },
    "bearing": {
        "blade_wear": 0.0, "bearing_fault": 1.0, "imbalance": 0.0,
        "misalignment": 0.0, "looseness": 0.0, "material_buildup": 0.0,
        "partial_clogging": 0.0, "choking": 0.0,
    },
    "blade": {
        "blade_wear": 1.0, "bearing_fault": 0.0, "imbalance": 0.0,
        "misalignment": 0.0, "looseness": 0.0, "material_buildup": 0.0,
        "partial_clogging": 0.0, "choking": 0.0,
    },
    "imbalance": {
        "blade_wear": 0.0, "bearing_fault": 0.0, "imbalance": 1.0,
        "misalignment": 0.0, "looseness": 0.0, "material_buildup": 0.0,
        "partial_clogging": 0.0, "choking": 0.0,
    },
    "misalignment": {
        "blade_wear": 0.0, "bearing_fault": 0.0, "imbalance": 0.0,
        "misalignment": 1.0, "looseness": 0.0, "material_buildup": 0.0,
        "partial_clogging": 0.0, "choking": 0.0,
    },
    "buildup": {
        "blade_wear": 0.0, "bearing_fault": 0.0, "imbalance": 0.0,
        "misalignment": 0.0, "looseness": 0.0, "material_buildup": 1.0,
        "partial_clogging": 0.0, "choking": 0.0,
    },
    "clogging": {
        "blade_wear": 0.0, "bearing_fault": 0.0, "imbalance": 0.0,
        "misalignment": 0.0, "looseness": 0.0, "material_buildup": 0.0,
        "partial_clogging": 1.0, "choking": 0.0,
    },
    "choking": {
        "blade_wear": 0.0, "bearing_fault": 0.0, "imbalance": 0.0,
        "misalignment": 0.0, "looseness": 0.0, "material_buildup": 0.0,
        "partial_clogging": 0.0, "choking": 1.0,
    },
    "combined": {
        "blade_wear": 0.5, "bearing_fault": 0.25, "imbalance": 0.3,
        "misalignment": 0.2, "looseness": 0.1, "material_buildup": 0.4,
        "partial_clogging": 0.5, "choking": 0.0,
    },
    "all": {
        "blade_wear": 1.0, "bearing_fault": 1.0, "imbalance": 1.0,
        "misalignment": 1.0, "looseness": 1.0, "material_buildup": 1.0,
        "partial_clogging": 1.0, "choking": 1.0,
    },
}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Pulveriser Digital Twin — Synthetic Data Generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--condition",
        default="healthy",
        choices=list(CONDITION_PRESETS.keys()),
        help="Machine condition preset (default: healthy)",
    )
    p.add_argument(
        "--severity",
        default=None,
        choices=list(SEVERITY_LEVEL_MAP.keys()),
        help="Uniform severity level applied to all faults in the preset",
    )
    # Fine-grained per-fault overrides
    for fault in ["blade-wear", "bearing", "imbalance", "misalignment",
                  "looseness", "buildup", "partial-clogging", "choking"]:
        p.add_argument(f"--{fault}", type=float, default=None,
                       metavar="0.0-1.0", help=f"Severity for {fault} fault")

    p.add_argument("--windows", type=int, default=10, help="Number of windows to simulate")
    p.add_argument("--config",  type=str, default=None, help="Path to custom config JSON")
    p.add_argument("--output",  type=str, default=None, help="Output file path (JSON or CSV)")
    p.add_argument("--format",  choices=["json", "csv"], default="json", help="Output format")
    p.add_argument("--seed",    type=int, default=42, help="Random seed")
    p.add_argument("--no-signals", action="store_true",
                   help="Omit raw signal arrays from output (smaller files)")
    return p


def apply_severity(preset: Dict[str, float], level_name: Optional[str]) -> Dict[str, float]:
    """Scale all non-zero severities in a preset to a uniform level."""
    if level_name is None:
        return preset
    scale = SEVERITY_LEVEL_MAP[level_name]
    return {k: (scale if v > 0 else 0.0) for k, v in preset.items()}


def flatten_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten a window record into a single-level dict for CSV output."""
    flat: Dict[str, Any] = {
        "window_idx": record["window_idx"],
        "timestamp":  record["timestamp"],
        "machine_id": record["machine_id"],
    }
    for fault, val in record.get("severity", {}).items():
        flat[f"sev_{fault}"] = val
    for sig_name, feat_dict in record.get("features", {}).items():
        for feat, val in feat_dict.items():
            flat[f"{sig_name}_{feat}"] = val
    for sig_name, ewma_dict in record.get("ewma", {}).items():
        for k, v in ewma_dict.items():
            flat[f"ewma_{sig_name}_{k}"] = v
    for idx_name, val in record.get("indices", {}).items():
        flat[idx_name] = val
    flat.update(record.get("alarms", {}))
    flat.update(record.get("kpis",   {}))
    return flat


def main(argv: Optional[list] = None) -> None:
    args = build_parser().parse_args(argv)

    # Build config
    base_cfg_dict = None
    if args.config:
        cfg = load_config(args.config)
    else:
        cfg = load_config()

    # Apply condition preset
    severities = dict(CONDITION_PRESETS[args.condition])
    severities = apply_severity(severities, args.severity)

    # Apply per-fault CLI overrides
    override_map = {
        "blade_wear":       args.blade_wear,
        "bearing_fault":    args.bearing,
        "imbalance":        args.imbalance,
        "misalignment":     args.misalignment,
        "looseness":        args.looseness,
        "material_buildup": args.buildup,
        "partial_clogging": args.partial_clogging,
        "choking":          args.choking,
    }
    for fault, val in override_map.items():
        if val is not None:
            severities[fault] = max(0.0, min(1.0, val))

    # Patch severity into config
    sev_obj = cfg.severity
    for fault, val in severities.items():
        setattr(sev_obj, fault, val)

    # Enable fault sub-configs that have non-zero severity
    _enable_fault_configs(cfg, severities)

    # Run simulator
    sim = PulveriserSimulator(cfg, seed=args.seed)
    records: List[Dict[str, Any]] = []

    print(f"\n🔧 Pulveriser Digital Twin — Synthetic Data Generator")
    print(f"   Condition : {args.condition}")
    print(f"   Severities: {severities}")
    print(f"   Windows   : {args.windows}")
    print()

    for i in range(args.windows):
        record = sim.run_window()
        if args.no_signals:
            record.pop("signals", None)
        records.append(record)
        idx = record["window_idx"]
        mhi = record["indices"]["MHI"]
        pqi = record["indices"]["PQI"]
        gqi = record["indices"]["GQI"]
        ct  = record["kpis"]["CycleTime"]
        tp  = record["kpis"]["Throughput"]
        alarm = record["alarms"]["severity"]
        print(
            f"  Window {idx:4d} | MHI={mhi:5.1f} PQI={pqi:5.1f} GQI={gqi:5.1f} "
            f"| CT={ct:6.1f}s TP={tp:6.1f}kg/hr | [{alarm}]"
        )

    # Save output
    if args.output:
        out_path = Path(args.output)
        fmt = args.format
        if fmt == "json":
            with open(out_path, "w", encoding="utf-8") as fh:
                json.dump(records, fh, indent=2)
            print(f"\n✅ Saved {len(records)} windows → {out_path} (JSON)")
        elif fmt == "csv":
            flat_records = [flatten_record(r) for r in records]
            if flat_records:
                with open(out_path, "w", newline="", encoding="utf-8") as fh:
                    writer = csv.DictWriter(fh, fieldnames=flat_records[0].keys())
                    writer.writeheader()
                    writer.writerows(flat_records)
            print(f"\n✅ Saved {len(records)} windows → {out_path} (CSV)")


def _enable_fault_configs(cfg: PulveriserConfig, severities: Dict[str, float]) -> None:
    """Patch enable flags in vibration/current/temperature configs based on severity."""
    enable_map = {
        "blade_wear":       ["blade_wear"],
        "bearing_fault":    ["bearing_fault"],
        "imbalance":        ["imbalance"],
        "misalignment":     ["misalignment"],
        "looseness":        ["looseness"],
        "material_buildup": ["material_buildup"],
        "partial_clogging": ["partial_clogging"],
        "choking":          ["choking"],
    }
    for fault, sev in severities.items():
        enabled = sev > 0
        for sig_cfg in [cfg.vibration, cfg.current, cfg.temperature]:
            if hasattr(sig_cfg, fault):
                sub = getattr(sig_cfg, fault)
                if isinstance(sub, dict):
                    sub["enable"] = enabled


if __name__ == "__main__":
    main()
