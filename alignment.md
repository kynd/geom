# Dodecahedron / Icosahedron dual alignment

## Goal

`mix(sdDodecahedron(p), sdIcosahedron(p), u_t)` should produce a clean dual morph:
each pentagon face of the dodecahedron shrinks to the corresponding icosahedron vertex,
and each dodecahedron vertex expands into a triangular icosahedron face.

For this to hold, the SDFs must be in **dual position**:
- Dodecahedron face normals = icosahedron vertex directions
- Icosahedron face normals = dodecahedron vertex directions

---

## Dodecahedron SDF

```glsl
float a = (q.y + PHI*q.z) / N;   // face normal (0, 1, φ)/N
float b = (q.x + PHI*q.y) / N;   // face normal (1, φ, 0)/N
float c = (PHI*q.x + q.z) / N;   // face normal (φ, 0, 1)/N
```

With `q = abs(p)` these 3 terms represent 12 face normals (4 sign combos each).
`N = √(1 + φ²) ≈ 1.9021` (magnitude of the unnormalised vertex vectors).

The 12 face normals are: `(0, ±1, ±φ)/N`, `(±1, ±φ, 0)/N`, `(±φ, 0, ±1)/N`.

These are exactly the 12 **icosahedron vertex** positions (at circumradius = 1). ✓

---

## Dodecahedron vertices (derived from SDF)

Vertices are where 3 face constraints are simultaneously tight.
Let `RHS = N·RIN = φ²/√3`. Solving in the positive octant:

| Case | Tight faces | Vertex direction |
|---|---|---|
| x = y = z | a = b = c | **(1, 1, 1)/√3** |
| x = 0 | a = b | **(0, φ, 1/φ)/√3** |
| y = 0 | a = c | **(1/φ, 0, φ)/√3** |
| z = 0 | b = c | **(φ, 1/φ, 0)/√3** |

All 4 directions have magnitude 1 (circumradius = 1 ✓).  
With sign variations: 8 + 4 + 4 + 4 = **20 vertices** ✓ (dodecahedron has 20 vertices).

---

## Icosahedron SDF — required face normals

The icosahedron face normals must equal the dodecahedron vertex directions above:

| # | Dodec vertex direction | Required SDF term |
|---|---|---|
| dA | (1, 1, 1)/√3 | `(q.x + q.y + q.z) * S3` |
| dB | **(0, φ, 1/φ)/√3** | `(PHI*q.y + q.z/PHI) * S3` |
| dC | **(1/φ, 0, φ)/√3** | `(q.x/PHI + PHI*q.z) * S3` |
| dD | **(φ, 1/φ, 0)/√3** | `(PHI*q.x + q.y/PHI) * S3` |

With sign variations: 8 + 4 + 4 + 4 = **20 face normals** ✓ (icosahedron has 20 faces).

---

## Bug in sdIcosahedron

The old code had dB, dC, dD pointing in wrong directions:

| Term | Old (wrong) direction | Correct direction |
|---|---|---|
| dB | (0, **1/φ**, **φ**)/√3 | (0, **φ**, **1/φ**)/√3 |
| dC | (**1/φ**, **φ**, 0)/√3 | (**1/φ**, 0, **φ**)/√3 |
| dD | (**φ**, 0, **1/φ**)/√3 | (**φ**, **1/φ**, 0)/√3 |

- dB: φ and 1/φ swapped in y/z positions
- dC: used `q.y` instead of `q.z` (wrong coordinate)
- dD: used `q.z` instead of `q.y` (wrong coordinate)

None of the wrong directions correspond to any dodecahedron vertex direction,
so the icosahedron was not in dual position with the dodecahedron.

---

## Fixed sdIcosahedron

```glsl
float dA = (q.x + q.y + q.z) * S3;
float dB = (PHI*q.y + q.z/PHI) * S3;   // was: q.y/PHI + PHI*q.z
float dC = (q.x/PHI + PHI*q.z) * S3;   // was: q.x/PHI + PHI*q.y
float dD = (PHI*q.x + q.y/PHI) * S3;   // was: PHI*q.x + q.z/PHI
return max(max(dA, dB), max(dC, dD)) - RIN;
```
