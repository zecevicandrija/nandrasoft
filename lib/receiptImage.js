import { Worker } from "node:worker_threads";

export const MAX_RECEIPT_BYTES = 32 * 1024 * 1024;
export const MAX_RECEIPT_PIXELS = 120_000_000;
export const RECEIPT_MAX_DIMENSION = 2560;
export const MAX_RECEIPT_JOBS = 3;

export class ReceiptImageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Infer the format from bytes, never from the filename or declared MIME type.
export function receiptImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_RECEIPT_BYTES) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buffer.length >= 16 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const boxSize = buffer.readUInt32BE(0);
    if (boxSize < 16 || boxSize > buffer.length || boxSize > 256) return null;
    const brands = [buffer.toString("ascii", 8, 12)];
    for (let offset = 16; offset + 4 <= boxSize; offset += 4) brands.push(buffer.toString("ascii", offset, offset + 4));
    if (brands.includes("avif")) return "avif";
    if (brands.some((brand) => ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand))) return "heif";
  }
  return null;
}

let queue = Promise.resolve();
let jobs = 0;

// One decoder at a time, outside the HTTP event loop. Bound queued buffers too.
export async function normalizeReceiptImage(buffer) {
  const format = receiptImageFormat(buffer);
  if (!format) throw new ReceiptImageError("Izabrani fajl nije podržana fotografija računa.");
  if (jobs >= MAX_RECEIPT_JOBS) throw new ReceiptImageError("Obrada fotografija je zauzeta. Pokušajte ponovo za nekoliko sekundi.", 503);
  jobs++;
  const previous = queue;
  let release;
  queue = new Promise((resolve) => { release = resolve; });
  try {
    await previous;
    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./receiptImageWorker.js", import.meta.url), {
        workerData: { buffer, format },
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      });
      let settled = false;
      const finish = async (error, output) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        await worker.terminate();
        if (error) reject(error);
        else resolve(Buffer.from(output));
      };
      const timer = setTimeout(() => finish(new ReceiptImageError("Obrada fotografije je trajala predugo. Pokušajte ponovo.", 422)), 30_000);
      worker.once("message", (message) => {
        if (message.error) finish(new ReceiptImageError("Fotografiju nije moguće obraditi. Pokušajte ponovo da je slikate.", 422));
        else finish(null, message.output);
      });
      worker.once("error", () => finish(new ReceiptImageError("Fotografiju nije moguće obraditi.", 422)));
      worker.once("exit", () => { if (!settled) finish(new ReceiptImageError("Obrada fotografije je prekinuta.", 422)); });
    });
  } finally {
    jobs--;
    release();
  }
}
