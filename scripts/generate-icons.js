const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createAssistantIconPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const center = (size - 1) / 2;
  const radius = size * 0.44;
  const cornerRadius = size * 0.22;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // Filter type 0 (None)

    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = Math.abs(x - center);
      const dy = Math.abs(y - center);

      // Rounded square SDF
      const qx = Math.max(dx - (radius - cornerRadius), 0);
      const qy = Math.max(dy - (radius - cornerRadius), 0);
      const dist = Math.sqrt(qx * qx + qy * qy) - cornerRadius;

      if (dist > 1.0) {
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
        continue;
      }

      const alpha = dist > 0 ? Math.round((1 - dist) * 255) : 255;

      // Gradient background: sleek Windows 11 cobalt/indigo/cyan
      const t = (x + y) / (2 * size);
      let r = Math.round(37 + t * 20);
      let g = Math.round(99 + t * 90);
      let b = Math.round(235 + t * 15);

      // Inner glyph: lightning/bot command symbol + ring
      const normX = (x - center) / radius;
      const normY = (y - center) / radius;
      const ringDist = Math.sqrt(normX * normX + normY * normY);

      // Subtle glowing inner ring
      if (ringDist > 0.62 && ringDist < 0.72) {
        r = 224;
        g = 242;
        b = 254;
      }

      // Bot visor / command prompt chevron '>' and '_'
      const inChevronUpper =
        normX > -0.35 &&
        normX < 0.08 &&
        Math.abs(normY - (normX * 0.75 - 0.05)) < 0.11;
      const inChevronLower =
        normX > -0.35 &&
        normX < 0.08 &&
        Math.abs(normY - (-normX * 0.75 - 0.05)) < 0.11;
      const inCursorBar =
        normX >= 0.10 &&
        normX <= 0.42 &&
        normY >= 0.14 &&
        normY <= 0.27;

      if (inChevronUpper || inChevronLower || inCursorBar) {
        r = 255;
        g = 255;
        b = 255;
      }

      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = alpha;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function createIcoFromPngs(pngEntries) {
  const count = pngEntries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;

  for (const entry of pngEntries) {
    const dir = Buffer.alloc(16);
    dir[0] = entry.size >= 256 ? 0 : entry.size;
    dir[1] = entry.size >= 256 ? 0 : entry.size;
    dir[2] = 0;
    dir[3] = 0;
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(entry.png.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirEntries.push(dir);
    offset += entry.png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngEntries.map((e) => e.png)]);
}

const iconsDir = path.join(__dirname, '..', 'assets', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const png256 = createAssistantIconPng(256);
const png64 = createAssistantIconPng(64);
const png32 = createAssistantIconPng(32);
const png16 = createAssistantIconPng(16);

fs.writeFileSync(path.join(iconsDir, 'icon.png'), png256);
fs.writeFileSync(path.join(iconsDir, 'tray.png'), png32);

const icoBuf = createIcoFromPngs([
  { size: 256, png: png256 },
  { size: 64, png: png64 },
  { size: 32, png: png32 },
  { size: 16, png: png16 }
]);
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), icoBuf);

console.log('[icons] Generated assets/icons/icon.png, tray.png, and icon.ico');
