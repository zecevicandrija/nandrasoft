import { parentPort, workerData } from "node:worker_threads";
import sharp from "sharp";
import { MAX_RECEIPT_PIXELS, RECEIPT_MAX_DIMENSION } from "./receiptImage.js";

sharp.cache(false);
sharp.concurrency(1);

try {
  const input = workerData.buffer;
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const options = { limitInputPixels: MAX_RECEIPT_PIXELS, failOn: "warning" };
  let image;
  if (workerData.format === "heif") {
    const { default: decode } = await import("heic-decode");
    const images = await decode.all({ buffer });
    try {
      const first = images[0];
      if (!first || first.width * first.height > MAX_RECEIPT_PIXELS) throw new Error("Image too large");
      const { width, height, data } = await first.decode();
      image = sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { ...options, raw: { width, height, channels: 4 } });
    } finally {
      images.dispose();
    }
  } else {
    image = sharp(buffer, options);
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp", "heif"].includes(metadata.format) || (metadata.pages || 1) > 1) throw new Error("Unsupported image");
  }
  const output = await image.autoOrient()
    .resize({ width: RECEIPT_MAX_DIMENSION, height: RECEIPT_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 88, mozjpeg: false })
    .timeout({ seconds: 20 })
    .toBuffer();
  parentPort.postMessage({ output });
} catch {
  parentPort.postMessage({ error: true });
}
