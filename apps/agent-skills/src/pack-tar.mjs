import { promises as fs } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const BLOCK_SIZE = 512;
const NAME_MAX = 100;

/**
 * Pack a directory into a deterministic gzipped ustar archive.
 * Files are added in sorted order; modification times are zeroed so the
 * archive (and its sha256 digest) is reproducible across builds.
 */
export async function packTarGz(sourceDir) {
  const files = [];
  await collect(sourceDir, "", files);
  files.sort((a, b) => a.archivePath.localeCompare(b.archivePath));

  const blocks = [];
  for (const file of files) {
    const data = await fs.readFile(file.absolutePath);
    blocks.push(buildHeader(file.archivePath, data.length));
    blocks.push(data);
    const padding = (BLOCK_SIZE - (data.length % BLOCK_SIZE)) % BLOCK_SIZE;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  // Two zero blocks terminate the archive.
  blocks.push(Buffer.alloc(BLOCK_SIZE * 2));

  const tar = Buffer.concat(blocks);
  return gzipSync(tar, { level: 9 });
}

async function collect(rootDir, currentRel, out) {
  const absDir = path.join(rootDir, currentRel);
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      await collect(rootDir, rel, out);
    } else if (entry.isFile()) {
      out.push({ absolutePath: abs, archivePath: rel });
    } else {
      throw new Error(`Unsupported entry type at ${rel} — only files and directories are allowed`);
    }
  }
}

function buildHeader(archivePath, size) {
  if (Buffer.byteLength(archivePath, "utf8") > NAME_MAX) {
    throw new Error(`Archive path too long for ustar (>100 bytes): ${archivePath}`);
  }
  if (archivePath.includes("\0")) {
    throw new Error(`Archive path contains NUL: ${archivePath}`);
  }

  const header = Buffer.alloc(BLOCK_SIZE);
  writeString(header, archivePath, 0, NAME_MAX);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8); // uid
  writeOctal(header, 0, 116, 8); // gid
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12); // mtime — zero for reproducibility
  // Checksum field (148, 8 bytes) starts as spaces for the calculation.
  header.fill(0x20, 148, 156);
  header[156] = 0x30; // type flag '0' = regular file
  writeString(header, "ustar", 257, 6);
  writeString(header, "00", 263, 2);

  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) sum += header[i];
  writeOctal(header, sum, 148, 7);
  header[155] = 0x20; // trailing space per POSIX

  return header;
}

function writeString(buffer, value, offset, maxLength) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > maxLength) {
    throw new Error(`String exceeds field length ${maxLength}: ${value}`);
  }
  bytes.copy(buffer, offset);
}

function writeOctal(buffer, value, offset, length) {
  // POSIX octal field: zero-padded, NUL-terminated (length-1 octal digits + NUL).
  const octal = value.toString(8).padStart(length - 1, "0");
  Buffer.from(octal, "ascii").copy(buffer, offset);
  buffer[offset + length - 1] = 0;
}
