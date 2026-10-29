# Local check picture for plan_to_diorama output: rooms (snapped), doors green, windows blue.
import json, sys
from PIL import Image, ImageDraw
src, res, out = sys.argv[1:4]
box = tuple(int(v) for v in sys.argv[4].split(',')) if len(sys.argv) > 4 else None
r = json.load(open(res))
im = Image.open(src).convert('RGB'); d = ImageDraw.Draw(im, 'RGBA')
cols = [(0,160,0,60),(0,0,255,60),(255,140,0,60),(160,0,160,60),(0,160,160,60),(120,120,0,60),(255,0,120,60),(0,90,255,60),(90,255,0,60),(255,200,0,60)]
for i, room in enumerate(r['pixels']['rooms']):
    d.polygon([tuple(p) for p in room], fill=cols[i % len(cols)], outline=(0,0,0,255))
    xs = [p[0] for p in room]; ys = [p[1] for p in room]
    d.text(((min(xs) + max(xs)) / 2 - 20, (min(ys) + max(ys)) / 2), r['rooms'][i]['id'], fill=(0, 0, 0, 255))
for o in r['pixels']['openings']:
    x, y = o['at']; half = o['width'] / 2
    c = (0, 170, 0, 255) if o['door'] else (0, 90, 255, 255)
    if o['upright']: d.line([(x, y - half), (x, y + half)], fill=c, width=7)
    else: d.line([(x - half, y), (x + half, y)], fill=c, width=7)
if box: im = im.crop(box)
f = min(1.0, 900 / im.width, 860 / im.height)
im.resize((int(im.width * f), int(im.height * f))).save(out)
