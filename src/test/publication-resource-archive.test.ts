import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { zip } from "./publication-resource-fixture";
import { publicationArchive } from "../publication-resource-archive";
const inflate = (bytes: Uint8Array, maxOutputLength: number) =>
  inflateRawSync(bytes, { maxOutputLength });
test("archive reader accepts stored/deflated bytes without writing paths", () => {
  const files = publicationArchive(
    zip([
      { name: "distribution/class.cls" },
      {
        name: "distribution/source.dtx",
        value: "Source notice",
        deflate: true,
      },
    ]),
    inflate,
  );
  assert.equal(
    new TextDecoder().decode(files["distribution/source.dtx"]),
    "Source notice",
  );
});
test("archive reader rejects traversal, absolute paths, duplicate names and symlinks", () => {
  for (const entries of [
    [{ name: "../class.cls" }],
    [{ name: "/class.cls" }],
    [{ name: "dir/../class.cls" }],
    [{ name: "class.cls" }, { name: "CLASS.cls" }],
    [{ name: "link.cls", mode: 0xa1ff }],
  ])
    assert.throws(() => publicationArchive(zip(entries), inflate), /Unsafe/);
});
test("archive reader rejects malformed offsets, size bombs and unsupported compression", () => {
  assert.throws(
    () => publicationArchive(new Uint8Array(4), inflate),
    /Invalid/,
  );
  for (const change of [
    (b: Buffer, c: number) => b.writeUInt32LE(20_000_000, c + 24),
    (b: Buffer, c: number) => b.writeUInt16LE(99, c + 10),
    (b: Buffer, c: number) => b.writeUInt32LE(0xffffffff, c + 42),
  ]) {
    const bytes = zip([{ name: "class.cls" }]);
    const c = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    change(bytes, c);
    assert.throws(() => publicationArchive(bytes, inflate));
  }
});

test("archive limits accept registry-sized entries and reject CRC damage and entry bombs", () => {
  const value = "x".repeat(26 * 1024 * 1024);
  const large = publicationArchive(
    zip([{ name: "source.dtx", value, deflate: true }]),
    inflate,
  );
  assert.equal(large["source.dtx"].length, value.length);
  const damaged = zip([{ name: "class.cls" }]);
  damaged[30 + "class.cls".length] ^= 1;
  assert.throws(() => publicationArchive(damaged, inflate), /CRC/);
  assert.throws(
    () =>
      publicationArchive(
        zip(Array.from({ length: 5001 }, (_, i) => ({ name: `file${i}` }))),
        inflate,
      ),
    /Unsupported|limit/,
  );
  assert.throws(
    () => publicationArchive(new Uint8Array(32 * 1024 * 1024 + 1), inflate),
    /too large/,
  );
});
