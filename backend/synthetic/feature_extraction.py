"""
feature_extraction.py — Time-domain and frequency-domain feature extractors.

Extracts the features listed in Section 11's ``feature_extraction`` config,
computed per window:
  - Vibration:    5000-sample window at 5 kHz
  - Current:      1000-sample window at 1 kHz
  - Temperature:  60-sample window at 1 Hz

All outputs are plain Python floats in a dictionary for easy JSON serialisation.
"""

from __future__ import annotations

import warnings
from typing import Dict, Tuple

import numpy as np
from scipy import signal as scipy_signal
from scipy.stats import kurtosis as scipy_kurtosis, skew as scipy_skew


# ---------------------------------------------------------------------------
# Time-domain features
# ---------------------------------------------------------------------------

def extract_time_domain(sig: np.ndarray) -> Dict[str, float]:
    """
    Compute time-domain statistical features for a signal window.

    Features (Section 11):
        RMS, Peak, Variance, CrestFactor, Kurtosis, Skewness

    Args:
        sig: 1-D signal array.

    Returns:
        Dict with keys: RMS, Peak, Variance, CrestFactor, Kurtosis, Skewness.
    """
    sig = np.asarray(sig, dtype=np.float64)
    n = len(sig)
    if n == 0:
        return {k: 0.0 for k in ["RMS", "Peak", "Variance", "CrestFactor", "Kurtosis", "Skewness"]}

    rms = float(np.sqrt(np.mean(sig ** 2)))
    peak = float(np.max(np.abs(sig)))
    variance = float(np.var(sig, ddof=1)) if n > 1 else 0.0
    crest_factor = float(peak / rms) if rms > 0 else 0.0
    kurt = float(scipy_kurtosis(sig, fisher=False, bias=False)) if n >= 4 else 0.0
    skewness = float(scipy_skew(sig, bias=False)) if n >= 3 else 0.0

    return {
        "RMS": rms,
        "Peak": peak,
        "Variance": variance,
        "CrestFactor": crest_factor,
        "Kurtosis": kurt,
        "Skewness": skewness,
    }


# ---------------------------------------------------------------------------
# Frequency-domain features
# ---------------------------------------------------------------------------

def _band_energy(freqs: np.ndarray, psd: np.ndarray, f_lo: float, f_hi: float) -> float:
    """Integrate PSD energy in [f_lo, f_hi] Hz."""
    mask = (freqs >= f_lo) & (freqs <= f_hi)
    if not np.any(mask):
        return 0.0
    df = freqs[1] - freqs[0] if len(freqs) > 1 else 1.0
    return float(np.sum(psd[mask]) * df)


def extract_frequency_domain(
    sig: np.ndarray,
    fs: int,
    nperseg: int | None = None,
) -> Dict[str, float]:
    """
    Compute frequency-domain features for a signal window.

    Features (Section 11):
        BandEnergy (Low / Mid / High), SpectralCentroid, PeakFrequency,
        THD (Total Harmonic Distortion), LowBandEnergy, MidBandEnergy, HighBandEnergy.

    Band definitions (adaptive to fs):
        Low:  0 – 0.1×Nyquist
        Mid:  0.1 – 0.4×Nyquist
        High: 0.4 – Nyquist

    Args:
        sig:     1-D signal array.
        fs:      Sampling frequency (Hz).
        nperseg: Welch PSD segment length (default: min(len(sig), 512)).

    Returns:
        Dict with spectral features.
    """
    sig = np.asarray(sig, dtype=np.float64)
    n = len(sig)
    nyq = fs / 2.0

    if n < 4:
        return {k: 0.0 for k in [
            "BandEnergy", "LowBandEnergy", "MidBandEnergy", "HighBandEnergy",
            "SpectralCentroid", "PeakFrequency", "THD",
        ]}

    if nperseg is None:
        nperseg = min(n, 512)
    nperseg = max(4, nperseg)

    # Welch PSD
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        freqs, psd = scipy_signal.welch(sig, fs=fs, nperseg=nperseg)

    total_energy = _band_energy(freqs, psd, 0.0, nyq)
    low_energy   = _band_energy(freqs, psd, 0.0,      0.1 * nyq)
    mid_energy   = _band_energy(freqs, psd, 0.1 * nyq, 0.4 * nyq)
    high_energy  = _band_energy(freqs, psd, 0.4 * nyq, nyq)

    # Spectral centroid (energy-weighted mean frequency)
    psd_sum = np.sum(psd)
    spectral_centroid = float(np.sum(freqs * psd) / psd_sum) if psd_sum > 0 else 0.0

    # Peak frequency (frequency of maximum PSD)
    peak_freq = float(freqs[np.argmax(psd)])

    # THD — ratio of harmonic energy (2nd, 3rd, 4th) to fundamental
    peak_idx = int(np.argmax(psd))
    fundamental = float(freqs[peak_idx]) if peak_idx < len(freqs) else 0.0
    harm_energy = 0.0
    fund_energy = _band_energy(freqs, psd, fundamental * 0.9, fundamental * 1.1)
    for h in [2, 3, 4]:
        hf = fundamental * h
        if hf < nyq:
            harm_energy += _band_energy(freqs, psd, hf * 0.9, hf * 1.1)
    thd = float(harm_energy / fund_energy) if fund_energy > 0 else 0.0

    return {
        "BandEnergy":       total_energy,
        "LowBandEnergy":    low_energy,
        "MidBandEnergy":    mid_energy,
        "HighBandEnergy":   high_energy,
        "SpectralCentroid": spectral_centroid,
        "PeakFrequency":    peak_freq,
        "THD":              thd,
    }


# ---------------------------------------------------------------------------
# FFT spectrum (for waveform display, not stored as a scalar)
# ---------------------------------------------------------------------------

def compute_fft(
    sig: np.ndarray, fs: int, n_lines: int = 512
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Return the one-sided FFT magnitude spectrum.

    Args:
        sig:     1-D signal array.
        fs:      Sampling frequency (Hz).
        n_lines: Number of frequency lines (output length = n_lines // 2).

    Returns:
        (freqs, magnitude) — both 1-D float arrays.
    """
    sig = np.asarray(sig, dtype=np.float64)
    n = min(len(sig), n_lines)
    fft_vals = np.fft.rfft(sig[:n])
    freqs = np.fft.rfftfreq(n, d=1.0 / fs)
    magnitude = np.abs(fft_vals) * 2.0 / n
    return freqs.astype(np.float64), magnitude.astype(np.float64)


# ---------------------------------------------------------------------------
# Combined extractor
# ---------------------------------------------------------------------------

def extract_all_features(
    vibration: np.ndarray,
    current: np.ndarray,
    temperature: np.ndarray,
    fs_vib: int = 5000,
    fs_cur: int = 1000,
    fs_temp: int = 1,
) -> Dict[str, Dict[str, float]]:
    """
    Extract all time-domain and frequency-domain features for one window.

    Args:
        vibration:    Vibration signal (g).
        current:      Motor current signal (A).
        temperature:  Temperature signal (°C).
        fs_vib:       Vibration sampling rate (Hz).
        fs_cur:       Current sampling rate (Hz).
        fs_temp:      Temperature sampling rate (Hz).

    Returns:
        Nested dict::

            {
                "vibration": {time-domain + freq-domain features},
                "current":   {time-domain + freq-domain features},
                "temperature": {time-domain features (no meaningful FFT at 1 Hz)},
            }
    """
    vib_td = extract_time_domain(vibration)
    vib_fd = extract_frequency_domain(vibration, fs_vib)
    vib_features = {**vib_td, **vib_fd}

    cur_td = extract_time_domain(current)
    cur_fd = extract_frequency_domain(current, fs_cur)
    cur_features = {**cur_td, **cur_fd}

    # Temperature: meaningful time-domain only (1 Hz → tiny bandwidth)
    temp_td = extract_time_domain(temperature)
    # Add rate of change as a useful extra feature
    if len(temperature) > 1:
        temp_td["RateOfChange"] = float(np.mean(np.diff(temperature)))
    else:
        temp_td["RateOfChange"] = 0.0

    return {
        "vibration":   vib_features,
        "current":     cur_features,
        "temperature": temp_td,
    }
