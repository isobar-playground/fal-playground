// Minimal dependency-free ZIP writer (STORE method, i.e. uncompressed --
// a valid, universally-openable ZIP; no DEFLATE implementation needed for a
// handful of small PNG crops). No new npm dependency, consistent with this
// repo's plain-browser-APIs approach elsewhere (see app/MaszynkaVideoView.tsx
// canvas cropping -- no image-processing library either).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; dateVal: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dateVal =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, dateVal };
}

export type ZipEntry = { name: string; data: Uint8Array };

/** Builds a valid, uncompressed (STORE) ZIP archive from in-memory entries. */
export function createZip(entries: ZipEntry[]): Blob {
  const { time, dateVal } = dosDateTime(new Date());
  const chunks: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true); // local file header signature
    localHeader.setUint16(4, 20, true); // version needed
    localHeader.setUint16(6, 0, true); // flags
    localHeader.setUint16(8, 0, true); // compression = store
    localHeader.setUint16(10, time, true);
    localHeader.setUint16(12, dateVal, true);
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, size, true); // compressed size
    localHeader.setUint32(22, size, true); // uncompressed size
    localHeader.setUint16(26, nameBytes.length, true);
    localHeader.setUint16(28, 0, true); // extra field length

    chunks.push(new Uint8Array(localHeader.buffer), nameBytes, entry.data);

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true); // central directory signature
    centralHeader.setUint16(4, 20, true); // version made by
    centralHeader.setUint16(6, 20, true); // version needed
    centralHeader.setUint16(8, 0, true); // flags
    centralHeader.setUint16(10, 0, true); // compression = store
    centralHeader.setUint16(12, time, true);
    centralHeader.setUint16(14, dateVal, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, size, true);
    centralHeader.setUint32(24, size, true);
    centralHeader.setUint16(28, nameBytes.length, true);
    centralHeader.setUint16(30, 0, true); // extra length
    centralHeader.setUint16(32, 0, true); // comment length
    centralHeader.setUint16(34, 0, true); // disk number start
    centralHeader.setUint16(36, 0, true); // internal attrs
    centralHeader.setUint32(38, 0, true); // external attrs
    centralHeader.setUint32(42, offset, true); // local header offset

    centralDirectory.push(new Uint8Array(centralHeader.buffer), nameBytes);

    offset += localHeader.byteLength + nameBytes.length + size;
  }

  const centralDirStart = offset;
  let centralDirSize = 0;
  for (const c of centralDirectory) centralDirSize += c.length;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // end of central directory signature
  eocd.setUint16(4, 0, true); // disk number
  eocd.setUint16(6, 0, true); // disk with central dir
  eocd.setUint16(8, entries.length, true); // entries on this disk
  eocd.setUint16(10, entries.length, true); // total entries
  eocd.setUint32(12, centralDirSize, true);
  eocd.setUint32(16, centralDirStart, true);
  eocd.setUint16(20, 0, true); // comment length

  return new Blob([...chunks, ...centralDirectory, new Uint8Array(eocd.buffer)] as BlobPart[], {
    type: "application/zip",
  });
}
