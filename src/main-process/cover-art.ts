import * as path from "path";
import * as fs from "fs";
import { parseFile } from "music-metadata";

import { withTimeout } from "./utils";

function ensureJpegComplete(buf: Buffer): Buffer {
  if (buf.length >= 2 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9) return buf;
  const out = new Uint8Array(buf.length + 2);
  out.set(buf);
  out[buf.length] = 0xff;
  out[buf.length + 1] = 0xd9;
  return Buffer.from(out);
}

export async function getCoverArt(filePath: string): Promise<string | null> {
  try {
    const { common } = await withTimeout(parseFile(filePath, { duration: false }), 10000);
    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0]!;
      let raw: Buffer = Buffer.from(pic.data);
      if (raw[0] === 0xff && raw[1] === 0xd8) raw = ensureJpegComplete(raw);
      return `data:${pic.format};base64,${raw.toString("base64")}`;
    }
  } catch { /* fall through */ }

  try {
    const dir = path.dirname(filePath);
    const entries = fs.readdirSync(dir);
    const folderImage = entries.find((e) => /^(folder|cover|front)\.(jpg|jpeg|png)$/i.test(e));
    if (folderImage) {
      const fullPath = path.join(dir, folderImage);
      const data = fs.readFileSync(fullPath);
      if (data[0] === 0xff && data[1] === 0xd8) {
        return `data:image/jpeg;base64,${ensureJpegComplete(data).toString("base64")}`;
      }
      if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
        return `data:image/png;base64,${data.toString("base64")}`;
      }
    }
  } catch { /* fall through */ }

  return null;
}
