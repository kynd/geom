import numpy as np
import librosa
from PIL import Image
import json
import os
import glob

def process_audio_to_text(input_wav, output_txt, fft_channels=128, fps=60, precision=4):
    """
    Converts a WAV file into per-channel amplitude and adaptive Mel-FFT data at a target FPS.

    Output row format (258 values):
      col 0        = L-channel RMS amplitude  (0–1, shared normalisation)
      col 1        = R-channel RMS amplitude  (0–1, shared normalisation)
      col 2..129   = L-channel Mel FFT bands  (0–1, shared normalisation)
      col 130..257 = R-channel Mel FFT bands  (0–1, shared normalisation)

    Mono files are duplicated to both channels so the format is always the same.
    """
    # Load stereo — shape (channels, samples); mono gives (1, samples) with mono=False
    y_raw, sr = librosa.load(input_wav, sr=None, mono=False)

    if y_raw.ndim == 1:
        y_raw = y_raw[np.newaxis, :]   # (samples,) → (1, samples)
    y_L = y_raw[0]
    y_R = y_raw[1] if y_raw.shape[0] > 1 else y_raw[0]
    y_mix = (y_L + y_R) * 0.5

    hop_length = int(sr / fps)
    n_fft      = 2048

    print(f"Processing: {os.path.basename(input_wav)}")
    ch_label = "stereo" if y_raw.shape[0] > 1 else "mono→stereo"
    print(f"  Sample Rate: {sr} Hz | Hop: {hop_length} | n_fft: {n_fft} | {ch_label}")

    # ── 1. STFT for each channel ─────────────────────────────────────────────────
    kw = dict(n_fft=n_fft, hop_length=hop_length, window='hann', center=True)
    stft_L   = np.abs(librosa.stft(y_L,   **kw))
    stft_R   = np.abs(librosa.stft(y_R,   **kw))
    stft_mix = (stft_L + stft_R) * 0.5
    freqs    = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    # ── 2. Frequency range detection from mix ────────────────────────────────────
    mean_spectrum = np.mean(stft_mix, axis=1)
    cum_energy    = np.cumsum(mean_spectrum)
    total_energy  = cum_energy[-1] if cum_energy[-1] > 0 else 1.0
    cum_norm      = cum_energy / total_energy

    f_min = max(20.0,   freqs[np.searchsorted(cum_norm, 0.05)])
    f_max = min(sr / 2, freqs[np.searchsorted(cum_norm, 0.85)])
    if f_max - f_min < 500:
        f_max = min(sr / 2, f_min + 2000)

    print(f"  Active range: {f_min:.1f} Hz – {f_max:.1f} Hz")

    # ── 3. Mel filterbank — same bank applied to both channels ───────────────────
    mel_basis  = librosa.filters.mel(sr=sr, n_fft=n_fft, n_mels=fft_channels,
                                     fmin=f_min, fmax=f_max)
    fft_L_data = np.dot(mel_basis, stft_L).T   # (frames, fft_channels)
    fft_R_data = np.dot(mel_basis, stft_R).T

    # ── 4. RMS per channel ───────────────────────────────────────────────────────
    rw = dict(frame_length=n_fft, hop_length=hop_length, center=True)
    rms_L = librosa.feature.rms(y=y_L, **rw).flatten()
    rms_R = librosa.feature.rms(y=y_R, **rw).flatten()

    # ── 5. Shared normalisation so L and R magnitudes are directly comparable ────
    rms_max = max(np.max(rms_L), np.max(rms_R), 1e-10)
    fft_max = max(np.max(fft_L_data), np.max(fft_R_data), 1e-10)

    rms_L_norm = np.clip(rms_L / rms_max, 0.0, 1.0)
    rms_R_norm = np.clip(rms_R / rms_max, 0.0, 1.0)
    fft_L_norm = np.clip(fft_L_data / fft_max, 0.0, 1.0)
    fft_R_norm = np.clip(fft_R_data / fft_max, 0.0, 1.0)

    num_frames = min(len(rms_L_norm), len(rms_R_norm),
                     len(fft_L_norm), len(fft_R_norm))
    fmt = f"%.{precision}f"

    # ── 6. Write text file ───────────────────────────────────────────────────────
    total_cols = 2 + fft_channels * 2   # amp_L amp_R fft_L[128] fft_R[128]
    with open(output_txt, 'w') as f:
        f.write(f"# Audio data extracted from: {os.path.basename(input_wav)}\n")
        f.write(f"# fps={fps} channels={fft_channels} precision={precision} frames={num_frames}\n")
        f.write(f"# freq_min={f_min:.2f} freq_max={f_max:.2f}\n")
        f.write(f"# Row format ({total_cols} values):\n")
        f.write(f"#   col 0        = L-channel RMS amplitude (0–1)\n")
        f.write(f"#   col 1        = R-channel RMS amplitude (0–1)\n")
        f.write(f"#   col 2..{1+fft_channels}   = L-channel Mel bands ({f_min:.0f}–{f_max:.0f} Hz)\n")
        f.write(f"#   col {2+fft_channels}..{1+fft_channels*2} = R-channel Mel bands ({f_min:.0f}–{f_max:.0f} Hz)\n")

        for i in range(num_frames):
            row = (fmt % rms_L_norm[i] + " " +
                   fmt % rms_R_norm[i] + " " +
                   " ".join(fmt % v for v in fft_L_norm[i]) + " " +
                   " ".join(fmt % v for v in fft_R_norm[i]) + "\n")
            f.write(row)

    print(f"  → {num_frames} frames written to '{output_txt}'")

    # ── 7. Spectrogram images (L, R, and mix — sqrt-normalised) ──────────────────
    px_w   = max(1, (num_frames + 9) // 10)
    stem   = os.path.splitext(output_txt)[0]

    def make_spec(fft_norm_data):
        arr = np.zeros((fft_channels, px_w), dtype=np.uint8)
        for px in range(px_w):
            f0 = px * 10; f1 = min(f0 + 10, num_frames)
            col = np.max(fft_norm_data[f0:f1], axis=0)
            arr[:, px] = (np.sqrt(col[::-1]) * 255).astype(np.uint8)
        return arr

    fft_mix_norm = (fft_L_norm + fft_R_norm) * 0.5
    for suffix, data in [('', fft_mix_norm), ('_L', fft_L_norm), ('_R', fft_R_norm)]:
        path = stem + suffix + '.png'
        Image.fromarray(make_spec(data), mode='L').save(path)
        print(f"  → spectrogram written to '{os.path.basename(path)}' ({px_w} × {fft_channels} px)")
    print()

    return {'freqMin': round(f_min, 2), 'freqMax': round(f_max, 2)}


if __name__ == "__main__":
    FFT_CHANNELS = 128
    FPS          = 60
    PRECISION    = 4

    script_dir = os.path.dirname(os.path.abspath(__file__))
    wav_files  = glob.glob(os.path.join(script_dir, "*.wav"))

    if not wav_files:
        print("No WAV files found in this directory.")
    else:
        meta = {}
        for wav_path in sorted(wav_files):
            base     = os.path.splitext(os.path.basename(wav_path))[0]
            out_path = os.path.join(script_dir, base + ".txt")
            result   = process_audio_to_text(wav_path, out_path, FFT_CHANNELS, FPS, PRECISION)
            meta[base] = result

        project_root = os.path.join(script_dir, '..', '..')
        data_dir     = os.path.join(project_root, 'src', 'data')
        os.makedirs(data_dir, exist_ok=True)
        meta_path = os.path.join(data_dir, 'sound-meta.json')
        with open(meta_path, 'w') as f:
            json.dump(meta, f, indent=2)
        print(f"Metadata written to '{meta_path}'")
