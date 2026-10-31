import "dotenv/config";
import crypto from "crypto";
import { normalizeReceiptImage, receiptImageFormat } from "./receiptImage.js";
export { MAX_RECEIPT_BYTES } from "./receiptImage.js";

const STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE_NAME || "nandrastorage";
const STORAGE_API_KEY = process.env.BUNNY_STORAGE_API_KEY || "";
const PULL_ZONE_HOSTNAME = process.env.BUNNY_PULL_ZONE_HOSTNAME || "nandra.b-cdn.net";
const STORAGE_HOST = process.env.BUNNY_STORAGE_HOST || "storage.bunnycdn.com";

const ALLOWED_MIME_TYPES = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
};

/**
 * Server-only metadata for a new receipt. Never includes credentials.
 */
function generateBunnyUploadConfig(fileType) {
  if (!STORAGE_API_KEY || !STORAGE_ZONE) {
    throw new Error("Bunny.net Storage konfiguracija nije podešena na serveru (.env).");
  }

  if (!ALLOWED_MIME_TYPES[fileType]) throw new Error("Unsupported receipt format.");
  const normalizedMime = fileType;
  const ext = ALLOWED_MIME_TYPES[fileType];

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const filePath = `racuni/${year}/${month}/racun_${crypto.randomUUID()}.${ext}`;
  const uploadUrl = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${filePath}`;
  const fileUrl = `https://${PULL_ZONE_HOSTNAME}/${filePath}`;

  return {
    uploadUrl,
    fileUrl,
    filePath,
    contentType: normalizedMime,
  };
}

// A quick signature gate; full decoding and re-encoding happen before storage.
export function isReceiptImage(buffer) {
  return receiptImageFormat(buffer) !== null;
}

// Upload receipts from the backend; clients cannot select a storage path.
export async function uploadBufferToBunny(buffer) {
  const normalized = await normalizeReceiptImage(buffer);
  if (!STORAGE_API_KEY || !STORAGE_ZONE) {
    throw new Error("Bunny.net Storage konfiguracija nije podešena na serveru.");
  }

  // Always generate a new path on the server; clients cannot overwrite files.
  const { uploadUrl, fileUrl, filePath, contentType } = generateBunnyUploadConfig("image/jpeg");

  let response;
  try {
    response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        AccessKey: STORAGE_API_KEY,
        "Content-Type": contentType,
      },
      body: normalized,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Bunny Storage upload failed.");
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Bunny Storage upload failed.");
  }

  return {
    fileUrl,
    filePath,
  };
}

