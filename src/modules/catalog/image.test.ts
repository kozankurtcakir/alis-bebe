import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { ImageError, MAX_IMAGE_BYTES, processImage } from "./image";

const blank = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#f4b942" } });

const rejects = (input: Uint8Array, message: RegExp) =>
  expect(processImage(input)).rejects.toThrow(message);

describe("geçerli görsel", () => {
  test.each(["jpeg", "png", "webp"] as const)(
    "%s, WebP olarak yeniden üretilir",
    async (format) => {
      const result = await processImage(
        await blank(40, 50).toFormat(format).toBuffer(),
      );
      expect(result).toMatchObject({ width: 40, height: 50 });
      expect((await sharp(result.data).metadata()).format).toBe("webp");
    },
  );

  test("büyük görsel 1600 piksele iner, oran korunur", async () => {
    const result = await processImage(
      await blank(3200, 4000).jpeg().toBuffer(),
    );
    expect(result).toMatchObject({ width: 1600, height: 2000 });
  });

  test("gizli bilgiler silinir, yön uygulanır", async () => {
    const input = await blank(40, 50)
      .jpeg()
      .withExif({
        IFD0: { Copyright: "gizli" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "39/1 46/1 0/1" },
      })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const result = await processImage(input);
    const meta = await sharp(result.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(result).toMatchObject({ width: 50, height: 40 });
  });
});

describe("reddedilen dosya", () => {
  test("boş dosya", () => rejects(new Uint8Array(), /boş/));

  test("görsel gibi adlandırılmış metin", () =>
    rejects(Buffer.from("<script>alert(1)</script>"), /geçerli bir görsel/));

  test("yalnızca JPEG başlığı taşıyan sahte dosya", () =>
    rejects(
      Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.alloc(500, 0x41),
      ]),
      /geçerli bir görsel/,
    ));

  test("SVG", () =>
    rejects(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>',
      ),
      /Yalnızca JPEG|geçerli bir görsel/,
    ));

  test("GIF", async () =>
    rejects(await blank(9, 9).gif().toBuffer(), /Yalnızca JPEG/));

  test("yarım kalmış JPEG", async () => {
    const full = await blank(800, 800).jpeg().toBuffer();
    await rejects(full.subarray(0, full.length / 2), /geçerli bir görsel/);
  });

  test("4 MB üstü", () =>
    rejects(new Uint8Array(MAX_IMAGE_BYTES + 1), /en fazla 4 MB/));

  test("az yer kaplayan ama dev boyutlu görsel", async () => {
    const bomb = await blank(9000, 9000).png().toBuffer();
    expect(bomb.byteLength).toBeLessThan(MAX_IMAGE_BYTES);
    await expect(processImage(bomb)).rejects.toBeInstanceOf(ImageError);
  });
});
