import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { normalizeReceiptImage } from "../lib/receiptImage.js";

// Local processing only: no database, credentials, storage upload or external requests.
// Pass representative photo paths to measure the deployment host with real images.
const paths = process.argv.slice(2);
const samples = paths.length
  ? await Promise.all(paths.map(async (path) => ({ name: path, buffer: await readFile(path) })))
  : [{
    name: "synthetic 12 MP JPEG (simple image; not representative of photo detail)",
    buffer: await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "white" } }).jpeg().toBuffer(),
  }];

for (const { name, buffer } of samples) {
  const cpu = process.cpuUsage();
  const start = performance.now();
  let peakRss = process.memoryUsage().rss;
  const sampleMemory = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
  try {
    const output = await normalizeReceiptImage(buffer);
    const used = process.cpuUsage(cpu);
    console.log(JSON.stringify({
      name, elapsedMs: Math.round(performance.now() - start),
      cpuMs: Math.round((used.user + used.system) / 1000),
      processPeakRssMiB: Math.round(peakRss / 1024 / 1024),
      inputKiB: Math.round(buffer.length / 1024), outputKiB: Math.round(output.length / 1024),
    }));
  } finally {
    clearInterval(sampleMemory);
  }
}
