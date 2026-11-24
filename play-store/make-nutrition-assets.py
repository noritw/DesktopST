# 食記 Play 商店素材（比照 make-dest-assets.ps1）。執行：python play-store/make-nutrition-assets.py
from PIL import Image, ImageDraw, ImageFont
import os
root = r'D:\DesktopST'
out = os.path.join(root, 'play-store', 'nutrition')
shots = os.path.join(out, 'screenshots')
os.makedirs(shots, exist_ok=True)

# 1. 截圖：Play 只收 16:9／9:16。裁掉狀態列與導覽列（1080x2160）後等比縮到 960x1920，
#    置中放進 1080x1920，兩側用截圖本身的底色補滿
for i, n in enumerate(['nutrition-daily-main', 'nutrition-add-food-top', 'nutrition-add-food-paste', 'nutrition-settings-colors'], 1):
    im = Image.open(os.path.join(root, 'docs', 'ScreenShot', n + '.png')).convert('RGB')
    body = im.crop((0, 140, 1080, 2300)).resize((960, 1920), Image.LANCZOS)
    canvas = Image.new('RGB', (1080, 1920), im.getpixel((8, 200)))
    canvas.paste(body, (60, 0))
    canvas.save(os.path.join(shots, f'{i:02d}-{n}.png'))

# 2. 圖示 512：沒有原圖，用 xxxhdpi 前景 432 放大（全滿版插圖，Play 自己加圓角）
fg = Image.open(os.path.join(root, r'nutrition\mobile\android\app\src\main\res\mipmap-xxxhdpi\ic_launcher_foreground.png')).convert('RGBA')
bg = Image.new('RGBA', fg.size, '#F2A65A'); bg.alpha_composite(fg)
icon = bg.resize((512, 512), Image.LANCZOS)
icon.save(os.path.join(out, 'icon-512.png'))

# 3. 主圖 1024x500：奶油→杏橘漸層，左文字、右圖示
W, H = 1024, 500
fgimg = Image.new('RGB', (W, H))
top, bot = (255, 250, 232), (250, 222, 178)
d = ImageDraw.Draw(fgimg)
for x in range(W):
    t = x / (W - 1)
    d.line([(x, 0), (x, H)], fill=tuple(int(top[k] + (bot[k] - top[k]) * t) for k in range(3)))
ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); od = ImageDraw.Draw(ov)
od.ellipse((600, -60, 1120, 460), fill=(255, 255, 255, 110)); od.ellipse((-120, 330, 180, 630), fill=(255, 255, 255, 110))
fgimg = Image.alpha_composite(fgimg.convert('RGBA'), ov)
pic = icon.resize((380, 380), Image.LANCZOS)
mask = Image.new('L', pic.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, 380, 380), radius=90, fill=255)
fgimg.paste(pic, (590, 60), mask)
d = ImageDraw.Draw(fgimg)
bold = r'C:\Windows\Fonts\msjhbd.ttc'; reg = r'C:\Windows\Fonts\msjh.ttc'
d.text((68, 110), '食記', font=ImageFont.truetype(bold, 104), fill='#5A4320')
d.text((72, 250), '拍張照，就記下這一餐', font=ImageFont.truetype(bold, 40), fill='#6B5530')
x = 72
for tag in ['拍照估熱量', '接手錶', '桌面小工具']:
    f = ImageFont.truetype(reg, 26); w = d.textlength(tag, font=f)
    d.rounded_rectangle((x, 330, x + w + 36, 378), radius=24, fill='#F0CD80')
    d.text((x + 18, 337), tag, font=f, fill='#5A4320'); x += w + 52
fgimg.convert('RGB').save(os.path.join(out, 'feature-graphic-1024x500.png'))
print('ok')
