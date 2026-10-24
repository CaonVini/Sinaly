import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  return bits.match(/.{1,5}/g)!.map((c) => ALPHABET[parseInt(c.padEnd(5, "0"), 2)]).join("");
}

function base32Decode(input: string): Buffer {
  let bits = "";
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Base32 inválido");
    bits += i.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

/** RFC 6238 / RFC 4226 (HMAC-SHA1, 6 dígitos). */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 0x0f;
  const code = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

export const currentStep = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / STEP_SECONDS);

/**
 * Aceita o passo atual e ±1 (deriva de relógio). Devolve o passo que bateu ou null.
 * O chamador deve rejeitar passo <= último usado (anti-replay).
 */
export function verifyTotp(secret: string, code: string, nowMs = Date.now()): number | null {
  const now = currentStep(nowMs);
  let matched: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const expected = Buffer.from(totpAt(secret, step));
    const given = Buffer.from(code);
    if (given.length === expected.length && timingSafeEqual(given, expected)) matched = step;
  }
  return matched;
}

export const otpauthUri = (secret: string, account: string) =>
  `otpauth://totp/Sinaly:${encodeURIComponent(account)}?secret=${secret}&issuer=Sinaly&digits=6&period=30`;
