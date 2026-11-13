"""Build stable Orange Audiobook icons using the same alpha outline as Orange Music.
Run in GitHub Actions; the supplied artwork is never redrawn.
"""
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/orange-audiobook.png'
REFERENCE = ROOT / 'assets/fnos-icon-alpha-reference.png'
SIZES = (16, 24, 48, 64, 72, 96, 128, 192, 256, 512)

def icon(size):
    artwork = Image.open(SOURCE).convert('RGBA').resize((size, size), Image.Resampling.LANCZOS)
    alpha = Image.open(REFERENCE).convert('RGBA').getchannel('A').resize((size, size), Image.Resampling.LANCZOS)
    artwork.putalpha(ImageChops.multiply(artwork.getchannel('A'), alpha))
    assert artwork.getpixel((0, 0))[3] < 8
    assert artwork.getpixel((size // 2, size - 1))[3] > 245
    return artwork

def main():
    public = ROOT / 'frontend/public'
    package = ROOT / '.github/ting-reader-fpk-native'
    images = package / 'app/ui/images'
    images.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        image = icon(size)
        image.save(images / f'icon_{size}.png', optimize=True)
        image.save(public / f'pwa-{size}.png', optimize=True)
    icon(256).save(images / 'icon_{0}.png', optimize=True)
    # Old, fixed addresses are aliases to this same artwork, never version names.
    icon(64).save(images / 'icon-64.png', optimize=True)
    icon(256).save(images / 'icon-256.png', optimize=True)
    icon(64).save(package / 'ICON.PNG', optimize=True)
    icon(256).save(package / 'ICON_256.PNG', optimize=True)
    icon(512).save(public / 'logo.png', optimize=True)
    icon(256).save(public / 'favicon.ico', sizes=[(16,16),(32,32),(48,48),(64,64)])
    for old in public.glob('pwa-*-maskable.png'):
        size = int(old.name.split('-')[1])
        icon(size).save(old, optimize=True)
    print('Verified fixed icon paths, transparent corners, native outline and all fnOS sizes.')

if __name__ == '__main__':
    main()
