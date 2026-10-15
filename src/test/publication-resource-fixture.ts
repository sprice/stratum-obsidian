import { deflateRawSync } from "node:zlib";
export function zip(
  entries: { name: string; value?: string; mode?: number; deflate?: boolean }[],
) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let position = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      value = Buffer.from(entry.value ?? "Synthetic class");
    const data = entry.deflate ? deflateRawSync(value) : value;
    const a = Buffer.alloc(30),
      b = Buffer.alloc(46);
    a.writeUInt32LE(0x04034b50);
    a.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    a.writeUInt32LE(data.length, 18);
    a.writeUInt32LE(value.length, 22);
    a.writeUInt16LE(name.length, 26);
    b.writeUInt32LE(0x02014b50);
    b.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    b.writeUInt32LE(data.length, 20);
    b.writeUInt32LE(value.length, 24);
    b.writeUInt16LE(name.length, 28);
    b.writeUInt32LE(((entry.mode ?? 0x81a4) * 65536) >>> 0, 38);
    b.writeUInt32LE(position, 42);
    local.push(a, name, data);
    central.push(b, name);
    position += a.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(position, 16);
  return Buffer.concat([...local, directory, end]);
}
