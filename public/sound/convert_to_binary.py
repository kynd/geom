#!/usr/bin/env python3
"""
convert_to_binary.py — one-time conversion of pre-computed .txt audio analysis
files to compact binary .bin format.

Binary format: raw little-endian Float32, n_frames × 258 values, same column
layout as the .txt rows: [ampL, ampR, melL[0..127], melR[0..127]].

Run from anywhere:
    python3 public/sound/convert_to_binary.py
"""
import os, glob
import numpy as np

SOUND_DIR = os.path.dirname(os.path.abspath(__file__))
N_COLS    = 258
SUBDIRS   = ['highlights', 'full', '0_00_1_00', '1_00_2_00', '2_00_3_00', '3_00_4_00']

def txt_to_bin(txt_path):
    rows = []
    with open(txt_path) as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith('#'):
                continue
            vals = list(map(float, s.split()))
            if len(vals) == N_COLS:
                rows.append(vals)
    if not rows:
        print(f'  SKIP (no data rows): {os.path.basename(txt_path)}')
        return 0
    arr = np.array(rows, dtype='<f4')   # explicit little-endian float32
    bin_path = txt_path[:-4] + '.bin'
    arr.tofile(bin_path)
    txt_kb = os.path.getsize(txt_path) // 1024
    bin_kb = os.path.getsize(bin_path) // 1024
    print(f'  {os.path.basename(txt_path)}: {txt_kb} KB → {bin_kb} KB  ({len(rows)} frames)')
    return len(rows)

total_files = 0
for subdir in SUBDIRS:
    path = os.path.join(SOUND_DIR, subdir)
    txts = sorted(glob.glob(os.path.join(path, '*.txt')))
    if not txts:
        continue
    print(f'\n{subdir}/')
    for txt in txts:
        txt_to_bin(txt)
        total_files += 1

print(f'\n✓ {total_files} files converted.')
