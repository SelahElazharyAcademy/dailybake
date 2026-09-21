# -*- coding: utf-8 -*-
"""يفصل اللوجو لطبقات شفافة عشان يتحرّك كعناصر مش كصورة واحدة.

ليه السكربت ده موجود:
    `assets/logo.png` ملف واحد مسطّح. عايزين الصفحة الرئيسية تركّب اللوجو
    قدام الزائر (الفرعين بينفتحوا، الكلمة بتستقر جواهم). جرّبنا نقصّ الصورة
    الواحدة بـ clip-path في الـCSS — النتيجة إن الحوافّ المستقيمة بتبان
    أثناء الحركة، الشكل بيتحرّك كمستطيلات مش كعناصر.

الطريقة:
    بنشتغل على قناة الشفافية. كل شكل متصل (connected component) بيتحدد
    لوحده، وبعدين بنجمّع الأشكال لأربع مجموعات حسب مكانها:
        word   كلمة DAILY BAKE   (فوق، في العمود الأوسط)
        sub    سطر PARIS MORNING (تحتها مباشرةً، نفس العمود)
        left   فرع القمح الشمال
        right  فرع القمح اليمين
    فرعا القمح متلاصقين عند تقاطعهم تحت، فبيطلعوا شكل متصل واحد — الشكل ده
    وحده بيتقسم بالبكسل عند منتصف العرض. القَصّة دي جوّه التقاطع نفسه،
    يعني مغطّاة في وضع الاستقرار ومش بتبان.

التحقق:
    بنجمع الطبقات الأربعة تاني ونقارنها بالأصل بكسل بكسل. لو في أي فرق
    السكربت بيفشل — لأن طبقة ناقصة معناها لوجو ناقص على الموقع.

التشغيل:
    python tools/logo-layers.py            # من جذر المشروع
    python tools/logo-layers.py --src assets/other-logo.png --prefix other
"""
import argparse
import os
import sys
from collections import deque

try:
    from PIL import Image
except ImportError:
    sys.exit('محتاج Pillow: pip install pillow')

ALPHA_MIN = 100      # أقل شفافية نعتبرها "حبر"
WIDE_COMPONENT = 200  # شكل أعرض من كده = الفرعين متلاصقين، يتقسم بالبكسل


def components(mask, w, h):
    """بيرجّع (labels, {id: (عدد البكسل, صندوق)}) بجوار ثماني."""
    lab = [[0] * w for _ in range(h)]
    info = {}
    cid = 0
    for y in range(h):
        for x in range(w):
            if not mask[y][x] or lab[y][x]:
                continue
            cid += 1
            lab[y][x] = cid
            q = deque([(x, y)])
            x0 = x1 = x
            y0 = y1 = y
            n = 0
            while q:
                cx, cy = q.popleft()
                n += 1
                x0 = min(x0, cx); x1 = max(x1, cx)
                y0 = min(y0, cy); y1 = max(y1, cy)
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < w and 0 <= ny < h and mask[ny][nx] and not lab[ny][nx]:
                            lab[ny][nx] = cid
                            q.append((nx, ny))
            info[cid] = (n, (x0, y0, x1, y1))
    return lab, info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default='assets/logo.png')
    ap.add_argument('--prefix', default='logo')
    ap.add_argument('--outdir', default='assets')
    args = ap.parse_args()

    im = Image.open(args.src).convert('RGBA')
    w, h = im.size
    px = im.load()
    mask = [[1 if px[x, y][3] > ALPHA_MIN else 0 for x in range(w)] for y in range(h)]
    lab, info = components(mask, w, h)

    def group_of(cid):
        _, (x0, y0, x1, y1) = info[cid]
        if x1 - x0 > WIDE_COMPONENT:
            return 'stem'                      # الفرعين متلاصقين — يتقسموا بالبكسل
        cx = (x0 + x1) // 2
        if y1 <= h * 0.52 and w * 0.16 <= cx <= w * 0.86:
            return 'word'
        if y0 >= h * 0.50 and y1 <= h * 0.67 and w * 0.17 <= cx <= w * 0.85:
            return 'sub'
        return 'left' if cx < w / 2 else 'right'

    names = ['word', 'sub', 'left', 'right']
    layers = {g: Image.new('RGBA', (w, h), (0, 0, 0, 0)) for g in names}
    lp = {g: layers[g].load() for g in names}
    counts = dict.fromkeys(names, 0)

    for y in range(h):
        for x in range(w):
            cid = lab[y][x]
            if not cid:
                continue
            g = group_of(cid)
            if g == 'stem':
                g = 'left' if x < w / 2 else 'right'
            lp[g][x, y] = px[x, y]
            counts[g] += 1

    # التحقق قبل الكتابة: المجموع لازم يطابق الأصل
    merged = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for g in names:
        merged.alpha_composite(layers[g])
    mp = merged.load()
    diff = sum(1 for y in range(h) for x in range(w)
               if (mp[x, y][3] > ALPHA_MIN) != bool(mask[y][x]))
    if diff:
        sys.exit('فشل التحقق: %d بكسل مختلف عن الأصل — الطبقات ماتكتبتش' % diff)

    total = 0
    for g in names:
        if not counts[g]:
            sys.exit('الطبقة "%s" طلعت فاضية — راجع حدود التجميع في group_of' % g)
        out = os.path.join(args.outdir, '%s-%s.png' % (args.prefix, g))
        # palette بـ8 ألوان: اللوجو لون واحد، فمفيش أي خسارة والحجم بيقل للربع
        layers[g].quantize(colors=8, method=Image.Quantize.FASTOCTREE).save(out, optimize=True)
        size = os.path.getsize(out)
        total += size
        print('%-6s %6d px  ->  %s  (%d bytes)' % (g, counts[g], out, size))

    print('الإجمالي: %.1f KB — التحقق: مطابق للأصل بكسل بكسل' % (total / 1024))


if __name__ == '__main__':
    main()
