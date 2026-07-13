"""
noise_models.py — Independently toggleable noise generators.

Three noise types (Section 9):
  1. Gaussian (white) sensor noise
  2. Random spike / glitch noise
  3. Linear drift noise (sensor aging)

Each generator is a pure function that takes a signal size and returns
a noise array of the same length, ready to be added to the clean signal.
"""

from __future__ import annotations

import numpy as np
from numpy.random import Generator


# ---------------------------------------------------------------------------
# 1. Gaussian (white) noise
# ---------------------------------------------------------------------------

def gaussian_noise(
    size: int,
    std: float,
    rng: Generator | None = None,
) -> np.ndarray:
    """
    Generate zero-mean Gaussian (white) noise.

    Args:
        size:  Number of samples.
        std:   Standard deviation (same units as the signal).
        rng:   Optional NumPy random Generator for reproducibility.

    Returns:
        1-D ndarray of shape (size,).
    """
    if rng is None:
        rng = np.random.default_rng()
    return rng.normal(0.0, std, size).astype(np.float64)


# ---------------------------------------------------------------------------
# 2. Random spike / glitch noise
# ---------------------------------------------------------------------------

def spike_noise(
    size: int,
    signal_rms: float,
    occurrence_rate: float = 0.0005,
    amplitude_factor: float = 5.0,
    rng: Generator | None = None,
) -> np.ndarray:
    """
    Generate random transient spike noise (sensor glitches).

    Args:
        size:             Number of samples.
        signal_rms:       RMS of the clean signal (used to scale spike amplitude).
        occurrence_rate:  Fraction of samples that receive a spike (0.01–0.1 % = 0.0001–0.001).
        amplitude_factor: Spike amplitude = amplitude_factor × signal_rms (2–10×).
        rng:              Optional NumPy random Generator.

    Returns:
        1-D ndarray of shape (size,).
    """
    if rng is None:
        rng = np.random.default_rng()

    noise = np.zeros(size, dtype=np.float64)
    n_spikes = max(1, int(size * occurrence_rate))

    # Random spike locations
    spike_indices = rng.integers(0, size, n_spikes)

    # Random spike signs and magnitudes
    spike_amplitudes = rng.choice([-1.0, 1.0], n_spikes) * rng.uniform(
        amplitude_factor * 0.5 * signal_rms,
        amplitude_factor * signal_rms,
        n_spikes,
    )
    noise[spike_indices] = spike_amplitudes
    return noise


# ---------------------------------------------------------------------------
# 3. Drift noise (sensor aging)
# ---------------------------------------------------------------------------

def drift_noise(
    size: int,
    signal_baseline: float,
    drift_rate_per_hour: float = 0.01,
    fs: int = 5000,
    rng: Generator | None = None,
) -> np.ndarray:
    """
    Generate linear sensor drift noise (aging / calibration shift).

    The drift accumulates linearly from 0 to
    ``drift_rate_per_hour × signal_baseline`` over one simulated hour.

    Args:
        size:                 Number of samples.
        signal_baseline:      Reference signal level (used to scale drift magnitude).
        drift_rate_per_hour:  Fractional drift per hour (0.001–0.05 → 0.1–5 %).
        fs:                   Sampling frequency (Hz), used to compute window duration.
        rng:                  Ignored — drift is deterministic.

    Returns:
        1-D ndarray of shape (size,).
    """
    duration_hours = size / (fs * 3600.0)
    total_drift = drift_rate_per_hour * signal_baseline * duration_hours
    return np.linspace(0.0, total_drift, size, dtype=np.float64)


# ---------------------------------------------------------------------------
# 4. Pink noise (1/f) approximation
# ---------------------------------------------------------------------------

def pink_noise(size: int, level: float, rng: Generator | None = None) -> np.ndarray:
    """
    Approximate pink (1/f) noise via Voss-McCartney superposition.

    Args:
        size:   Number of samples.
        level:  Scale factor (std of output is roughly proportional to level).
        rng:    Optional NumPy random Generator.

    Returns:
        1-D ndarray of shape (size,).
    """
    if rng is None:
        rng = np.random.default_rng()

    n_octaves = 8
    arrays = rng.standard_normal((n_octaves, size))
    pink = np.zeros(size, dtype=np.float64)
    for k in range(n_octaves):
        step = 2 ** k
        upsampled = np.repeat(arrays[k, ::step], step)[:size]
        pink += upsampled
    pink /= n_octaves
    std = np.std(pink)
    if std > 0:
        pink = pink / std * level
    return pink


# ---------------------------------------------------------------------------
# 5. Brown noise (1/f²) approximation
# ---------------------------------------------------------------------------

def brown_noise(size: int, level: float, rng: Generator | None = None) -> np.ndarray:
    """
    Approximate Brownian (1/f²) noise via cumulative sum of white noise.

    Args:
        size:   Number of samples.
        level:  Scale factor.
        rng:    Optional NumPy random Generator.

    Returns:
        1-D ndarray of shape (size,).
    """
    if rng is None:
        rng = np.random.default_rng()

    white = rng.standard_normal(size)
    brown = np.cumsum(white)
    # Remove DC drift and normalise
    brown -= brown.mean()
    std = np.std(brown)
    if std > 0:
        brown = brown / std * level
    return brown.astype(np.float64)


# ---------------------------------------------------------------------------
# 6. Combined noise builder (convenience)
# ---------------------------------------------------------------------------

def build_vibration_noise(
    size: int,
    signal_rms: float,
    white_std: float = 0.02,
    pink_level: float = 0.01,
    brown_level: float = 0.005,
    enable_spikes: bool = True,
    spike_rate: float = 0.0003,
    spike_factor: float = 4.0,
    enable_drift: bool = False,
    drift_rate: float = 0.005,
    fs: int = 5000,
    rng: Generator | None = None,
) -> np.ndarray:
    """
    Compose all three vibration noise layers into a single array.
    Any layer can be disabled by setting its level/std to 0.
    """
    if rng is None:
        rng = np.random.default_rng()

    noise = gaussian_noise(size, white_std, rng=rng)

    if pink_level > 0:
        noise += pink_noise(size, pink_level, rng=rng)

    if brown_level > 0:
        noise += brown_noise(size, brown_level, rng=rng)

    if enable_spikes and spike_rate > 0:
        noise += spike_noise(size, signal_rms, occurrence_rate=spike_rate,
                             amplitude_factor=spike_factor, rng=rng)

    if enable_drift and drift_rate > 0:
        noise += drift_noise(size, signal_rms, drift_rate_per_hour=drift_rate, fs=fs)

    return noise


def build_current_noise(
    size: int,
    signal_rms: float,
    std: float = 0.05,
    enable_spikes: bool = False,
    spike_rate: float = 0.0001,
    spike_factor: float = 3.0,
    rng: Generator | None = None,
) -> np.ndarray:
    """Compose current noise layers."""
    if rng is None:
        rng = np.random.default_rng()

    noise = gaussian_noise(size, std, rng=rng)

    if enable_spikes and spike_rate > 0:
        noise += spike_noise(size, signal_rms, occurrence_rate=spike_rate,
                             amplitude_factor=spike_factor, rng=rng)

    return noise


def build_temperature_noise(
    size: int,
    noise_std: float = 0.2,
    rng: Generator | None = None,
) -> np.ndarray:
    """Temperature noise — simple Gaussian."""
    if rng is None:
        rng = np.random.default_rng()
    return gaussian_noise(size, noise_std, rng=rng)
