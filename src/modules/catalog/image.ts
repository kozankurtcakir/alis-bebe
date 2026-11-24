import sharp from "sharp";

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_WIDTH = 1600;
const MAX_PIXELS = 40_000_000;
const FORMATS = ["jpeg", "png", "webp"];

export class ImageError extends Error {}

/**
 * Yüklenen dosyayı gerçekten açar ve WebP olarak yeniden üretir. Böylece sahte
 * dosyalar elenir; konum gibi gizli bilgiler (EXIF) yeni dosyaya geçmez.
 */
export async function processImage(input: Uint8Array) {
  if (input.byteLength === 0) throw new ImageError("Dosya boş.");
  if (input.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageError("Görsel en fazla 4 MB olabilir.");
  }

  const options = { limitInputPixels: MAX_PIXELS, failOn: "error" } as const;
  let format: string | undefined;
  let pages: number | undefined;
  try {
    ({ format, pages } = await sharp(input, options).metadata());
  } catch {
    throw new ImageError("Dosya geçerli bir görsel değil.");
  }
  if (!format || !FORMATS.includes(format)) {
    throw new ImageError("Yalnızca JPEG, PNG veya WebP yükleyin.");
  }
  if (pages && pages > 1) {
    throw new ImageError("Hareketli görsel yüklenemez.");
  }

  try {
    const { data, info } = await sharp(input, options)
      .rotate() // Telefonun yön bilgisini uygular; bilgi sonra silinir.
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    if (info.height > 10_000 || data.byteLength > MAX_IMAGE_BYTES) {
      throw new ImageError("Görsel çok büyük.");
    }
    return { data, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw new ImageError("Dosya geçerli bir görsel değil.");
  }
}
