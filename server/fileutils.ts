import { promises as fs } from "node:fs";
import path from "node:path";

export type ImageSize = { width: number; height: number };

export async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function copyFileSafe(src: string, dst: string) {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
}

export function isSubPath(parent: string, child: string) {
  const rel = path.relative(parent, child);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function readUInt24LE(buf: Buffer, offset: number) {
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
}

function getPngSize(buf: Buffer): ImageSize | null {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width && height ? { width, height } : null;
}

function getGifSize(buf: Buffer): ImageSize | null {
  if (buf.length < 10) return null;
  const header = buf.toString("ascii", 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  return width && height ? { width, height } : null;
}

function getJpegSize(buf: Buffer): ImageSize | null {
  if (buf.length < 4) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 1 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 1 >= buf.length) break;
    const size = buf.readUInt16BE(offset);
    if (size < 2) break;
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      if (offset + 7 < buf.length) {
        const height = buf.readUInt16BE(offset + 3);
        const width = buf.readUInt16BE(offset + 5);
        return width && height ? { width, height } : null;
      }
    }
    offset += size;
  }
  return null;
}

function getWebpSize(buf: Buffer): ImageSize | null {
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunkType = buf.toString("ascii", 12, 16);
  if (chunkType === "VP8X") {
    const width = 1 + readUInt24LE(buf, 24);
    const height = 1 + readUInt24LE(buf, 27);
    return { width, height };
  }
  if (chunkType === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    const width = 1 + (b0 | ((b1 & 0x3f) << 8));
    const height = 1 + (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));
    return { width, height };
  }
  if (chunkType === "VP8 ") {
    const dataOffset = 20;
    if (buf.length < dataOffset + 10) return null;
    if (buf[dataOffset + 3] !== 0x9d || buf[dataOffset + 4] !== 0x01 || buf[dataOffset + 5] !== 0x2a) return null;
    const width = buf.readUInt16LE(dataOffset + 6) & 0x3fff;
    const height = buf.readUInt16LE(dataOffset + 8) & 0x3fff;
    return width && height ? { width, height } : null;
  }
  return null;
}

export async function readImageSize(filePath: string): Promise<ImageSize | null> {
  const ext = path.extname(filePath).toLowerCase();
  if (![".png", ".webp", ".jpg", ".jpeg", ".gif"].includes(ext)) return null;
  try {
    const buf = await fs.readFile(filePath);
    switch (ext) {
      case ".png":
        return getPngSize(buf);
      case ".gif":
        return getGifSize(buf);
      case ".jpg":
      case ".jpeg":
        return getJpegSize(buf);
      case ".webp":
        return getWebpSize(buf);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
