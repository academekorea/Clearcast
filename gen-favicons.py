#!/usr/bin/env python3
"""Generate aperture favicon PNGs from scratch using only stdlib."""
import math, struct, zlib, os

def render_aperture(size, supersampling=4):
    S = supersampling
    big = size * S
    cx = big / 2.0
    cy = big / 2.0
    scale = big / 512.0

    outer_r  = 218.0 * scale
    center_r =  86.0 * scale
    blade_cy = -115.0 * scale
    blade_rx =  88.0 * scale
    blade_ry = 138.0 * scale
    blade_angles = [15, 75, 135, 195, 255, 315]

    # Pre-compute sin/cos for each blade angle
    blades = [(math.cos(math.radians(a)), math.sin(math.radians(a))) for a in blade_angles]

    navy = (10, 15, 30, 255)
    white = (255, 255, 255, 255)

    # Render at high res
    hi = []
    for y in range(big):
        row = []
        for x in range(big):
            dx = x - cx
            dy = y - cy
            dist2 = dx*dx + dy*dy
            if dist2 > outer_r * outer_r or dist2 <= center_r * center_r:
                row.append(navy)
                continue
            on_blade = False
            for (ca, sa) in blades:
                xr =  dx * ca + dy * sa
                yr = -dx * sa + dy * ca
                by = yr - blade_cy
                if (xr / blade_rx)**2 + (by / blade_ry)**2 <= 1:
                    on_blade = True
                    break
            row.append(white if on_blade else navy)
        hi.append(row)

    # Downsample with box filter
    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            rs = gs = bs = as_ = 0
            for sy in range(S):
                for sx in range(S):
                    r, g, b, a = hi[y*S + sy][x*S + sx]
                    rs += r; gs += g; bs += b; as_ += a
            count = S * S
            row.append((rs//count, gs//count, bs//count, as_//count))
        pixels.append(row)
    return pixels

def write_png(filename, width, height, pixels):
    raw = b''
    for row in pixels:
        raw += b'\x00'
        for r, g, b, a in row:
            raw += bytes([r, g, b, a])

    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    ihdr = chunk(b'IHDR', struct.pack('>II', width, height) + bytes([8, 6, 0, 0, 0]))
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')

    with open(filename, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend)
    print(f'  {filename} ({os.path.getsize(filename):,} bytes)')

os.chdir(os.path.dirname(os.path.abspath(__file__)))

configs = [
    ('favicon-16x16.png', 16, 2),
    ('favicon-32x32.png', 32, 4),
    ('apple-touch-icon.png', 180, 4),
    ('android-chrome-192x192.png', 192, 4),
    ('android-chrome-512x512.png', 512, 4),
]

for (fname, size, ss) in configs:
    print(f'Rendering {fname} ({size}x{size}, {ss}x supersampling)...')
    pixels = render_aperture(size, ss)
    write_png(fname, size, size, pixels)

# Also create a simple ICO (16x16 + 32x32 bundled)
print('\nCreating favicon.ico...')
def ico_entry(bmp_data, w, h):
    return bytes([w if w < 256 else 0, h if h < 256 else 0, 0, 0, 1, 0, 32, 0]) + \
           struct.pack('<I', len(bmp_data)) + b'\x00\x00\x00\x00'  # offset filled later

def make_ico(sizes_px):
    entries = []
    images = []
    for sz in sizes_px:
        p = render_aperture(sz, 2)
        buf = bytearray()
        buf += b'\x89PNG\r\n\x1a\n'
        def chunk(tag, data):
            c = tag + data
            return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        raw = b''
        for row in p:
            raw += b'\x00'
            for r, g, b, a in row:
                raw += bytes([r, g, b, a])
        buf += chunk(b'IHDR', struct.pack('>II', sz, sz) + bytes([8, 6, 0, 0, 0]))
        buf += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        buf += chunk(b'IEND', b'')
        entries.append((sz, bytes(buf)))

    # ICO header
    header = struct.pack('<HHH', 0, 1, len(entries))
    # directory entries (6 byte header + 16 bytes per entry)
    dir_offset = 6 + 16 * len(entries)
    current_offset = dir_offset
    dir_entries = b''
    img_data = b''
    for (sz, img) in entries:
        w = sz if sz < 256 else 0
        dir_entries += bytes([w, w, 0, 0, 1, 0, 32, 0])
        dir_entries += struct.pack('<II', len(img), current_offset)
        img_data += img
        current_offset += len(img)

    with open('favicon.ico', 'wb') as f:
        f.write(header + dir_entries + img_data)
    print(f'  favicon.ico ({os.path.getsize("favicon.ico"):,} bytes)')

make_ico([16, 32])
print('\nAll favicon assets generated.')
