import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/auth.js";
import { requireWorkerIdentity } from "../lib/workerIdentity.js";
import { isReceiptImage, MAX_RECEIPT_BYTES, uploadBufferToBunny } from "../lib/bunnyStorage.js";
import { MAX_RECEIPT_JOBS, ReceiptImageError } from "../lib/receiptImage.js";
const router = Router();
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RECEIPT_BYTES, files: 1, fields: 0, parts: 1 },
});

let photoUploads = 0;
function limitPhotoUploads(req, res, next) {
  // Admit before multer allocates buffers, including requests waiting for decoding.
  if (photoUploads >= MAX_RECEIPT_JOBS) {
    res.set("Retry-After", "3");
    return res.status(503).json({ error: "Slanje fotografija je zauzeto. Pokušajte ponovo za nekoliko sekundi." });
  }
  photoUploads++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    photoUploads--;
  };
  res.once("finish", release);
  res.once("close", release);
  next();
}

// Svi endpointi zahtevaju prijavljenog korisnika
router.use(requireAuth);
router.use(requireWorkerIdentity);

// ==========================================
// Upload fotografija preko autentifikovanog backenda
// ==========================================
function parsePhotoUpload(req, res, next) {
  uploadMemory.single("file")(req, res, (error) => {
    if (error) {
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: "Pošaljite jednu fotografiju do 32 MB, bez dodatnih polja.",
      });
    }
    next();
  });
}

router.post("/upload", limitPhotoUploads, parsePhotoUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Fotografija nije prosleđena." });
    }
    if (!isReceiptImage(req.file.buffer)) {
      return res.status(400).json({ error: "Pošaljite fotografiju (JPEG, PNG, WebP, HEIC ili AVIF) do 32 MB." });
    }
    const result = await uploadBufferToBunny(req.file.buffer, "fotografije");
    res.json(result);
  } catch (error) {
    if (error instanceof ReceiptImageError) {
      if (error.status === 503) res.set("Retry-After", "3");
      return res.status(error.status).json({ error: error.message });
    }
    res.status(502).json({ error: "Otpremanje fotografije nije uspelo. Pokušajte ponovo." });
  }
});


export default router;
