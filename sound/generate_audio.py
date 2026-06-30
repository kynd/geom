#!/usr/bin/env python3
"""
generate_audio.py — generates full-track and per-minute segment files for
all stems, starting from the originals in sound/original/.

Run from anywhere:
    python3 sound/generate_audio.py

Output layout (public/sound/):
    full/           {base}.bin / .mp3 / .png   — full ~4-min track
    highlights/     {base}.bin / .mp3 / .png   — best 60-s window (trim_audio.py)
    0_00_1_00/      {base}.bin / .mp3 / .png   — frames 0–3599
    1_00_2_00/      {base}.bin / .mp3 / .png   — frames 3600–7199
    2_00_3_00/      {base}.bin / .mp3 / .png   — frames 7200–10799
    3_00_4_00/      {base}.bin / .mp3 / .png   — frames 10800–end

Binary format: raw little-endian Float32, n_frames × 258 values per frame.
Column layout: [ampL, ampR, melL[0..127], melR[0..127]].

This script writes full/ and segment folders.  highlights/ is produced by
trim_audio.py and is left untouched here.

Dependencies: numpy, Pillow, ffmpeg (all already used by trim_audio.py).
"""

import os, re, shutil, subprocess
import numpy as np
from PIL import Image

FPS       = 60
NUM_BANDS = 128

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ORIG_DIR   = os.path.join(SCRIPT_DIR, 'original')
SOUND_DIR  = os.path.abspath(os.path.join(SCRIPT_DIR, '..', 'public', 'sound'))
FULL_DIR   = os.path.join(SOUND_DIR, 'full')
SEG_DIRS   = {label: os.path.join(SOUND_DIR, label) for _, _, label in [
    (0, 60, '0_00_1_00'), (60, 120, '1_00_2_00'),
    (120, 180, '2_00_3_00'), (180, 240, '3_00_4_00'),
]}

STEMS = [
    '250621_a1_mix1_arp',
    '250621_a1_mix1_bass',
    '250621_a1_mix1_hat',
    '250621_a1_mix1_kick1',
    '250621_a1_mix1_kick2',
    '250621_a1_mix1_pad',
    '250621_a1_mix1_snare',
    '250621_a1_mix1_master_88.2k24',
]

# (start_seconds, end_seconds, filename_label)
SEGMENTS = [
    (  0,  60, '0_00_1_00'),
    ( 60, 120, '1_00_2_00'),
    (120, 180, '2_00_3_00'),
    (180, 240, '3_00_4_00'),
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def load_txt(path):
    """Returns (header_lines, data_lines) as raw text — not parsed to floats."""
    header, data = [], []
    with open(path) as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            (header if s.startswith('#') else data).append(line)
    return header, data

def patch_frames(header, n):
    """Replace 'frames=N' in the fps/channels/precision header line."""
    return [re.sub(r'frames=\d+', f'frames={n}', l) for l in header]

def write_bin(path, data_lines):
    rows = [list(map(float, l.split())) for l in data_lines if l.strip()]
    np.array(rows, dtype='<f4').tofile(path)

def make_spec(fft_data):
    n    = len(fft_data)
    px_w = max(1, (n + 9) // 10)
    arr  = np.zeros((NUM_BANDS, px_w), dtype=np.uint8)
    for px in range(px_w):
        f0, f1 = px * 10, min(px * 10 + 10, n)
        col = np.max(fft_data[f0:f1], axis=0)
        arr[:, px] = (np.sqrt(col[::-1]) * 255).astype(np.uint8)
    return arr

def write_spectrograms(base_out, data_lines):
    rows  = [list(map(float, l.split())) for l in data_lines]
    fft_L = np.array([r[2:130]   for r in rows])
    fft_R = np.array([r[130:258] for r in rows])
    fft_M = (fft_L + fft_R) * 0.5
    peak  = max(fft_M.max(), fft_L.max(), fft_R.max(), 1e-9)
    for suffix, data in [('', fft_M / peak), ('_L', fft_L / peak), ('_R', fft_R / peak)]:
        Image.fromarray(make_spec(data), mode='L').save(base_out + suffix + '.png')
    print(f'    specs regenerated')

def encode_mp3(wav, out_mp3, start_s=None, duration_s=None):
    cmd = ['ffmpeg', '-i', wav]
    if start_s is not None:
        cmd += ['-ss', str(start_s)]
    if duration_s is not None:
        cmd += ['-t', str(duration_s)]
    cmd += ['-codec:a', 'libmp3lame', '-qscale:a', '2', '-y', out_mp3]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f'    MP3 ERROR: {r.stderr[-300:]}')
        return False
    kb = os.path.getsize(out_mp3) // 1024
    print(f'    → {os.path.basename(out_mp3)}  ({kb} KB)')
    return True

# ── Ensure output subdirectories exist ───────────────────────────────────────

for d in [FULL_DIR] + list(SEG_DIRS.values()):
    os.makedirs(d, exist_ok=True)

# ── Full track + per-minute segments ─────────────────────────────────────────

for base in STEMS:
    orig_txt = os.path.join(ORIG_DIR, base + '.txt')
    orig_wav = os.path.join(ORIG_DIR, base + '.wav')
    print(f'── {base}')

    if not os.path.exists(orig_txt):
        print(f'  SKIP — {orig_txt} not found'); continue
    if not os.path.exists(orig_wav):
        print(f'  SKIP — {orig_wav} not found'); continue

    header, data = load_txt(orig_txt)
    total = len(data)

    # ── full track → full/ ────────────────────────────────────────────────────
    out_base = os.path.join(FULL_DIR, base)
    write_bin(out_base + '.bin', data)
    print(f'  full: {total} frames  → full/{base}.bin')
    write_spectrograms(out_base, data)
    encode_mp3(orig_wav, out_base + '.mp3')

    # ── per-minute segments → 0_00_1_00/ etc. ────────────────────────────────
    for start_s, end_s, label in SEGMENTS:
        f0 = int(start_s * FPS)
        f1 = min(int(end_s * FPS), total)
        if f0 >= total:
            continue
        seg      = data[f0:f1]
        seg_base = os.path.join(SEG_DIRS[label], base)
        write_bin(seg_base + '.bin', seg)
        print(f'  {label}: {len(seg)} frames  → {label}/{base}.bin')
        write_spectrograms(seg_base, seg)
        encode_mp3(orig_wav, seg_base + '.mp3', start_s=start_s, duration_s=end_s - start_s)

    print()

print('✓ done')
