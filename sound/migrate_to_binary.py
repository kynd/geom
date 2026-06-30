#!/usr/bin/env python3
"""
migrate_to_binary.py — updates all JS demo files from .txt/parseData to .bin/parseBinary

Run from repo root:
    python3 sound/migrate_to_binary.py
"""
import re, os, glob

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

PARSE_BINARY = """\
function parseBinary(buffer) {
  const f32 = new Float32Array(buffer);
  const N = 258, n = (f32.length / N) | 0;
  const frames = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * N;
    frames[i] = { amp: (f32[o] + f32[o + 1]) * 0.5, ampL: f32[o], ampR: f32[o + 1], fftL: f32.subarray(o + 2, o + 130), fftR: f32.subarray(o + 130, o + 258) };
  }
  return frames;
}"""

# Regex that matches the whole parseData function body (handles variable-length bodies)
PARSE_DATA_RE = re.compile(
    r'function parseData\(text\)\s*\{.*?\n\}',
    re.DOTALL
)

TARGET_FILES = sorted(glob.glob(os.path.join(REPO, 'public', '**', 'main.js'), recursive=True))

def migrate(path):
    with open(path) as f:
        src = f.read()

    if 'parseData' not in src and '.txt' not in src:
        return False  # nothing to do

    orig = src

    # 1. Replace parseData function with parseBinary
    if 'function parseData' in src:
        src = PARSE_DATA_RE.sub(PARSE_BINARY, src)

    # 2. TRACKS array: txt: '...' → bin: '...'
    src = re.sub(r"\btxt:\s*'([^']+)\.txt'", r"bin: '\1.bin'", src)

    # 3. TRACKS access: .txt → .bin
    src = re.sub(r'\bTRACKS\[([^\]]+)\]\.txt\b', r'TRACKS[\1].bin', src)
    src = re.sub(r'\bt\.txt\b', 't.bin', src)

    # 4. Two-line pattern:
    #   const res = await fetch(SOUND_BASE + TRACKS[idx].bin);
    #   allFrames = parseData(await res.text());
    src = re.sub(
        r'const res = await fetch\(([^)]+)\);\s*\n(\s*)allFrames = parseData\(await res\.text\(\)\);',
        r'allFrames = parseBinary(await (await fetch(\1)).arrayBuffer());',
        src
    )

    # 5. Inline fetch pattern: parseData(await fetch(`...txt`).then(r => r.text()))
    #    → parseBinary(await fetch(`...bin`).then(r => r.arrayBuffer()))
    src = src.replace('.txt`).then(r => r.text())', '.bin`).then(r => r.arrayBuffer())')

    # 6. Two-line sound-analysis pattern:
    #   const res  = await fetch(`${basePath}.txt`);
    #   const text = await res.text();
    #   frames       = parseData(text);
    src = re.sub(
        r'const res\s+=\s+await fetch\(`(\$\{[^}]+\})\.txt`\);\s*\n\s*const text\s+=\s+await res\.text\(\);\s*\n(\s*)frames\s+=\s+parseData\(text\);',
        r'frames = parseBinary(await (await fetch(`\1.bin`)).arrayBuffer());',
        src
    )

    # 7. basePath/.base inline pattern (warp, env-map, flash-light, ridge, sound-wave, scalar-effects):
    #   frames = parseData(await fetch(`${basePath}.txt`).then(r => r.text()));
    src = re.sub(
        r'frames\s*=\s*parseData\(await fetch\(`(\$\{[^}]+\})\.txt`\)\.then\(r => r\.text\(\)\)\);',
        r'frames = parseBinary(await fetch(`\1.bin`).then(r => r.arrayBuffer()));',
        src
    )

    # 8. Generic remaining .txt` → .bin` in sound-related fetch calls
    src = re.sub(r'(\$\{[^}]*(?:base|Base|path|Path|SOUND)[^}]*\})\.txt`', r'\1.bin`', src)

    # 9. Pre-computed .txt label string in drawComparison (fill-harmonic)
    src = src.replace("pre-computed .txt)", "pre-computed .bin)")

    if src == orig:
        return False

    with open(path, 'w') as f:
        f.write(src)
    return True

changed = []
for path in TARGET_FILES:
    rel = os.path.relpath(path, REPO)
    if migrate(path):
        changed.append(rel)
        print(f'  updated: {rel}')
    else:
        print(f'  skip:    {rel}')

print(f'\n✓ {len(changed)} files updated.')
