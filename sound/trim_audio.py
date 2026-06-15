#!/usr/bin/env python3
"""
For each stem, find the densest 60-second window in the full analysis data,
then emit a trimmed .bin and trimmed .mp3 to public/sound/highlights/.
Also regenerates the L/R spectrogram PNGs.

Binary format: raw little-endian Float32, n_frames × 258 values per frame.
"""
import os, subprocess, numpy as np
from PIL import Image

FPS          = 60
WINDOW_SECS  = 60
WINDOW_FRAMES = FPS * WINDOW_SECS
NUM_BANDS    = 128

ORIG_DIR = os.path.join(os.path.dirname(__file__), 'original')
OUT_DIR  = os.path.join(os.path.dirname(__file__), '..', 'public', 'sound', 'highlights')

STEMS = [
    ('arp',    '250621_a1_mix1_arp'),
    ('bass',   '250621_a1_mix1_bass'),
    ('hat',    '250621_a1_mix1_hat'),
    ('kick1',  '250621_a1_mix1_kick1'),
    ('kick2',  '250621_a1_mix1_kick2'),
    ('pad',    '250621_a1_mix1_pad'),
    ('snare',  '250621_a1_mix1_snare'),
    ('master', '250621_a1_mix1_master_88.2k24'),
]

def load_txt(path):
    rows = []
    header = []
    with open(path) as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            if s.startswith('#'):
                header.append(line)
            else:
                v = list(map(float, s.split()))
                rows.append(v)
    return header, rows

def find_best_window(rows):
    amps = np.array([(r[0] + r[1]) * 0.5 for r in rows])
    n = len(amps)
    if n <= WINDOW_FRAMES:
        return 0, n
    cs = np.concatenate([[0], np.cumsum(amps)])
    sums = cs[WINDOW_FRAMES:n] - cs[:n - WINDOW_FRAMES]
    best = int(np.argmax(sums))
    return best, best + WINDOW_FRAMES

def make_spec(fft_data):
    """fft_data: list of 128-element rows (already normalised 0-1)"""
    n = len(fft_data)
    px_w = max(1, n // 10)
    arr = np.zeros((NUM_BANDS, px_w), dtype=np.uint8)
    for px in range(px_w):
        f0, f1 = px * 10, min(px * 10 + 10, n)
        col = np.max(fft_data[f0:f1], axis=0)
        arr[:, px] = (np.sqrt(col[::-1]) * 255).astype(np.uint8)
    return arr

for label, base in STEMS:
    txt_path = os.path.join(ORIG_DIR, f'{base}.txt')
    wav_path = os.path.join(ORIG_DIR, f'{base}.wav')

    print(f'\n── {label} ({base})')
    header, rows = load_txt(txt_path)
    start_f, end_f = find_best_window(rows)
    start_s = start_f / FPS
    print(f'   window : frames {start_f}–{end_f}  ({start_s:.1f}s – {start_s + WINDOW_SECS:.1f}s)')

    trimmed = rows[start_f:end_f]

    # ── trimmed .bin ──────────────────────────────────────────────────────────
    out_bin = os.path.join(OUT_DIR, f'{base}.bin')
    np.array(trimmed, dtype='<f4').tofile(out_bin)
    bin_kb = os.path.getsize(out_bin) // 1024
    print(f'   bin    : {out_bin}  ({len(trimmed)} frames, {bin_kb} KB)')

    # ── trimmed MP3 ──────────────────────────────────────────────────────────
    out_mp3 = os.path.join(OUT_DIR, f'{base}.mp3')
    cmd = ['ffmpeg', '-ss', str(start_s), '-t', str(WINDOW_SECS),
           '-i', wav_path, '-codec:a', 'libmp3lame', '-qscale:a', '2',
           '-y', out_mp3]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        kb = os.path.getsize(out_mp3) / 1024
        print(f'   mp3    : {out_mp3}  ({kb:.0f} KB)')
    else:
        print(f'   mp3 ERROR:\n{res.stderr[-300:]}')

    # ── spectrograms (mix, L, R) ──────────────────────────────────────────────
    fft_L = np.array([r[2:130]          for r in trimmed])
    fft_R = np.array([r[130:258]        for r in trimmed])
    fft_M = (fft_L + fft_R) * 0.5

    # Shared normalisation across all three
    peak = max(fft_M.max(), fft_L.max(), fft_R.max(), 1e-9)
    fft_M_n = fft_M / peak
    fft_L_n = fft_L / peak
    fft_R_n = fft_R / peak

    for suffix, data in [('', fft_M_n), ('_L', fft_L_n), ('_R', fft_R_n)]:
        path = os.path.join(OUT_DIR, f'{base}{suffix}.png')
        Image.fromarray(make_spec(data), mode='L').save(path)
    print(f'   specs  : mix / L / R regenerated')

print('\n✓ done')
