import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { putObject, removeObject, thumbKey } from "./storage.js";

export class ImageError extends Error {}

const ACCEPTED = new Set(["jpeg", "png", "webp"]);
const MAX_PIXELS = 40_000_000; // protege contra "bomba de descompressão"

/**
 * Valida pelo CONTEÚDO (não pela extensão nem pelo Content-Type enviado), reorienta,
 * redimensiona e regrava como JPEG. Reencodar descarta EXIF (inclusive GPS),
 * qualquer carga embutida e formatos perigosos como SVG.
 */
export async function processPhoto(input: Buffer): Promise<{ full: Buffer; thumb: Buffer }> {
  try {
    const base = () => sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" });
    const meta = await base().metadata();
    if (!meta.format || !ACCEPTED.has(meta.format)) throw new ImageError("Formato de imagem não suportado (use JPEG, PNG ou WebP)");
    const render = (size: number, quality: number) =>
      base().rotate().flatten({ background: "#ffffff" }).resize({ width: size, height: size, fit: "inside", withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
    const [full, thumb] = await Promise.all([render(1600, 80), render(400, 70)]);
    return { full, thumb };
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError("Imagem inválida ou corrompida");
  }
}

/** Grava foto + miniatura com nome aleatório; devolve a chave da foto principal. */
export async function storePhoto(input: Buffer): Promise<string> {
  const { full, thumb } = await processPhoto(input);
  const key = `occ/${randomUUID()}.jpg`;
  try {
    await putObject(key, full);
    await putObject(thumbKey(key), thumb);
  } catch (e) {
    await discardPhoto(key);
    throw e;
  }
  return key;
}

export async function discardPhoto(key: string | null | undefined): Promise<void> {
  if (!key) return;
  await Promise.allSettled([removeObject(key), removeObject(thumbKey(key))]);
}
