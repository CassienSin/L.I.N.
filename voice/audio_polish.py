"""Tidy each spoken sentence before it is played: trim the dead air at both ends, fade the edges so there is
no click, bring every sentence to the same loudness, and keep the peaks below clipping.
Pure numpy, so it is checked without the voice model (verify_voice.py)."""
import numpy as np

TARGET_DBFS = -20.0     # one loudness for every sentence (RMS of the voiced part)
CEILING = 0.89          # about -1 dBFS: peaks never clip
LEAD_MS, TAIL_MS = 40, 140   # a natural breath before and after each sentence
FADE_MS = 8


def _frames_db(wave, sr, frame_ms=10):
    n = max(1, int(sr * frame_ms / 1000))
    usable = len(wave) // n * n
    if not usable:
        return np.array([-120.0]), n
    frames = wave[:usable].reshape(-1, n)
    rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
    return 20 * np.log10(rms), n


def silence_ms(wave, sr, floor_db=None):
    """Leading and trailing quiet, in milliseconds (what the voice lab reports)."""
    db, n = _frames_db(np.asarray(wave, dtype=np.float32), sr)
    floor = (db.max() - 40) if floor_db is None else floor_db
    loud = np.nonzero(db > floor)[0]
    if not len(loud):
        return len(wave) / sr * 1000, 0.0
    return loud[0] * n / sr * 1000, (len(db) - 1 - loud[-1]) * n / sr * 1000


def loudness_dbfs(wave, sr):
    db, _ = _frames_db(np.asarray(wave, dtype=np.float32), sr)
    voiced = db[db > db.max() - 40]
    if not len(voiced):
        return -120.0
    return float(20 * np.log10(np.sqrt(np.mean((10 ** (voiced / 20)) ** 2))))


def polish(wave, sr):
    """Returns the tidied sentence. Never makes it shorter than the voiced part."""
    wave = np.asarray(wave, dtype=np.float32).reshape(-1).copy()
    wave -= float(np.mean(wave))                      # no DC offset (a thump at the start)
    db, n = _frames_db(wave, sr)
    floor = db.max() - 40
    loud = np.nonzero(db > floor)[0]
    if len(loud):
        start = max(0, loud[0] * n - int(sr * LEAD_MS / 1000))
        end = min(len(wave), (loud[-1] + 1) * n + int(sr * TAIL_MS / 1000))
        wave = wave[start:end]
    gain_db = TARGET_DBFS - loudness_dbfs(wave, sr)
    wave *= 10 ** (max(-18.0, min(18.0, gain_db)) / 20)
    peak = float(np.max(np.abs(wave))) if len(wave) else 0.0
    if peak > CEILING:
        # A soft knee above 70% of the ceiling instead of hard clipping.
        knee = 0.7 * CEILING
        over = np.abs(wave) > knee
        x = np.abs(wave[over])
        squashed = knee + (CEILING - knee) * np.tanh((x - knee) / (CEILING - knee))   # smooth, never reaches the ceiling
        wave[over] = np.sign(wave[over]) * squashed
    f = min(len(wave) // 4, int(sr * FADE_MS / 1000))
    if f > 1:
        ramp = np.linspace(0.0, 1.0, f, dtype=np.float32)
        wave[:f] *= ramp
        wave[-f:] *= ramp[::-1]
    return np.clip(wave, -CEILING, CEILING)
