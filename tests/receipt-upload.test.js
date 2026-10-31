import assert from "node:assert/strict";
import { test, mock } from "node:test";
import express from "express";
import sharp from "sharp";
import { readFile } from "node:fs/promises";

// Test credentials only. Every storage request is intercepted locally.
process.env.BUNNY_STORAGE_API_KEY = "test-storage-secret-never-return-to-browser";
process.env.BUNNY_STORAGE_ZONE_NAME = "test-zone";
process.env.BUNNY_STORAGE_HOST = "storage.example.test";
process.env.BUNNY_PULL_ZONE_HOSTNAME = "receipts.example.test";
const { default: fuelRouter } = await import("../routes/fuel.js");
const { auth } = await import("../routes/auth.js");
const { prisma } = await import("../lib/prisma.js");
const { MAX_RECEIPT_BYTES } = await import("../lib/bunnyStorage.js");

const png = await sharp({ create: { width: 80, height: 120, channels: 3, background: "white" } }).png().toBuffer();

test("receipt upload keeps storage credentials and paths under server control", async (t) => {
  let session = null;
  let upstreamFailure = false;
  const uploads = [];
  const realFetch = globalThis.fetch;
  const sessionMock = mock.method(auth.api, "getSession", async () => session);
  const originalWorker = prisma.worker;
  prisma.worker = { async findUnique() { return { id: "worker-profile", userId: "worker", isActive: true }; } };
  const fetchMock = mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).startsWith("https://storage.example.test/")) {
      uploads.push({ url, options });
      return new Response(upstreamFailure ? process.env.BUNNY_STORAGE_API_KEY : "", {
        status: upstreamFailure ? 403 : 201,
      });
    }
    return realFetch(url, options);
  });
  const app = express();
  app.use("/api/fuel", fuelRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}/api/fuel`;
  async function upload({ data = png, mime = "image/png", extraPath, path = "/upload", missing = false } = {}) {
    const body = new FormData();
    if (!missing) body.append("file", new Blob([data], { type: mime }), "../../old-receipt.png");
    if (extraPath) body.append("filePath", extraPath);
    return fetch(`${baseURL}${path}`, { method: "POST", body });
  }

  try {
    await t.test("authentication is required for uploads and former configuration endpoints", async () => {
      for (const path of ["/upload", "/upload-fallback", "/upload-url", "/upload-config"]) {
        assert.equal((await upload({ path })).status, 401);
      }
      assert.equal(uploads.length, 0);
      session = { user: { id: "worker", role: "OPERATER", isActive: true }, session: {} };
    });

    await t.test("former configuration endpoints return no secrets", async () => {
      for (const path of ["/upload-url", "/upload-config"]) {
        const response = await fetch(`${baseURL}${path}`, { method: "POST" });
        assert.equal(response.status, 410);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.doesNotMatch(await response.text(), /AccessKey|test-storage-secret|storage\.example/);
      }
    });

    await t.test("uploads are proxied with server-only credentials and unique generated paths", async () => {
      for (const path of ["/upload", "/upload-fallback"]) {
        const response = await upload({ path });
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.deepEqual(Object.keys(result).sort(), ["filePath", "fileUrl"]);
        assert.match(result.filePath, /^racuni\/\d{4}\/\d{2}\/racun_[a-f0-9-]{36}\.jpg$/);
        assert.equal(result.fileUrl, `https://receipts.example.test/${result.filePath}`);
        assert.doesNotMatch(JSON.stringify(result), /AccessKey|test-storage-secret/);
        const request = uploads.at(-1);
        assert.equal(request.options.headers.AccessKey, process.env.BUNNY_STORAGE_API_KEY);
        assert.equal(request.options.redirect, "error");
        assert.equal(request.options.headers["Content-Type"], "image/jpeg");
        const image = await sharp(request.options.body).metadata();
        assert.equal(image.format, "jpeg");
        assert.equal(image.width, 80);
        assert.equal(image.height, 120);
      }
      assert.notEqual(uploads[0].url, uploads[1].url);
    });

    await t.test("rejects client-selected paths, missing files, fake images and oversized uploads", async () => {
      const before = uploads.length;
      assert.equal((await upload({ extraPath: "racuni/../../overwrite.png" })).status, 400);
      assert.equal((await upload({ missing: true })).status, 400);
      assert.equal((await upload({ data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), mime: "image/png" })).status, 400);
      assert.equal((await upload({ data: Buffer.from("<script>bad</script>") })).status, 400);
      assert.equal((await upload({ data: png.subarray(0, 25) })).status, 422);
      assert.equal((await upload({ data: Buffer.alloc(MAX_RECEIPT_BYTES + 1) })).status, 413);
      assert.equal(uploads.length, before);
    });

    await t.test("real photo bytes determine the format, not the supplied MIME", async () => {
      assert.equal((await upload({ mime: "application/octet-stream" })).status, 200);
      assert.equal((await sharp(uploads.at(-1).options.body).metadata()).format, "jpeg");
    });

    await t.test("JPEG, WebP and AVIF phone images are decoded and saved as real JPEG", async () => {
      for (const format of ["jpeg", "webp", "avif"]) {
        const photo = await sharp(png).toFormat(format).toBuffer();
        assert.equal((await upload({ data: photo, mime: "application/octet-stream" })).status, 200);
        const image = await sharp(uploads.at(-1).options.body).metadata();
        assert.equal(image.format, "jpeg");
        assert.equal(image.width, 80);
        assert.equal(image.height, 120);
      }
    });

    await t.test("large phone photos are resized automatically and metadata is stripped", async () => {
      const photo = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "white" } })
        .jpeg().withMetadata({ orientation: 6 }).toBuffer();
      assert.equal((await upload({ data: photo, mime: "image/jpeg" })).status, 200);
      const image = await sharp(uploads.at(-1).options.body).metadata();
      assert.equal(image.width, 1920);
      assert.equal(image.height, 2560);
      assert.equal(image.orientation, undefined);
      assert.equal(image.exif, undefined);
    });

    await t.test("excessive declared dimensions are rejected before storage", async () => {
      const before = uploads.length;
      const forged = Buffer.from(png);
      forged.writeUInt32BE(100_000, 16);
      forged.writeUInt32BE(100_000, 20);
      assert.equal((await upload({ data: forged })).status, 422);
      assert.equal(uploads.length, before);
    });

    await t.test("HEIC originals are automatically converted when the browser cannot decode them", async () => {
      const photo = await readFile(new URL("./fixtures/receipt-sample.heic", import.meta.url));
      assert.equal((await upload({ data: photo, mime: "application/octet-stream" })).status, 200);
      const image = await sharp(uploads.at(-1).options.body).metadata();
      assert.equal(image.format, "jpeg");
      assert.ok(image.width > 0 && image.width <= 2560);
      assert.ok(image.height > 0 && image.height <= 2560);
    });

    await t.test("concurrent uploads have a bounded admission queue before buffering files", async () => {
      const requests = Array.from({ length: 8 }, () => upload());
      const responses = await Promise.all(requests);
      const statuses = responses.map((response) => response.status);
      assert.equal(statuses.filter((status) => status === 200).length, 3);
      assert.equal(statuses.filter((status) => status === 503).length, 5);
      for (const response of responses.filter((response) => response.status === 503)) {
        assert.equal(response.headers.get("retry-after"), "3");
      }
      // Capacity is released after responses finish, including rejected uploads.
      assert.equal((await upload()).status, 200);
    });

    await t.test("storage errors cannot echo credentials into API responses", async () => {
      upstreamFailure = true;
      const response = await upload();
      assert.equal(response.status, 502);
      assert.doesNotMatch(await response.text(), /AccessKey|test-storage-secret/);
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fetchMock.mock.restore();
    sessionMock.mock.restore();
    prisma.worker = originalWorker;
  }
});
