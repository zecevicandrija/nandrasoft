export interface CompressedImageResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
  originalSizeKB: number;
  compressedSizeKB: number;
  previewUrl: string;
}

/**
 * Klijentska kompresija slike fiskalnog računa na mobilnom telefonu / računaru pomoću HTML5 Canvasa.
 * Smanjuje fotografije od 5-15 MB na ~150-250 KB (WebP / JPEG) uz očuvanje oštrine teksta računa.
 */
export async function compressImage(
  file: File,
  maxDimension = 1600,
  quality = 0.82
): Promise<CompressedImageResult> {
  const originalSizeKB = Math.max(1, Math.round(file.size / 1024));

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        let { width, height } = img;

        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Pretraživač ne podržava obradu slike (Canvas 2D).'));
          return;
        }

        // Beli fon za transparentne PNG slike
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const baseName = file.name.replace(/\.[^/.]+$/, '') || 'racun';

        // Pokušaj WebP format (najbolja kompresija za tekst računa), fallback na JPEG
        canvas.toBlob(
          (webpBlob) => {
            if (webpBlob && webpBlob.type === 'image/webp') {
              const previewUrl = URL.createObjectURL(webpBlob);
              URL.revokeObjectURL(objectUrl);
              resolve({
                blob: webpBlob,
                fileName: `${baseName}.webp`,
                mimeType: 'image/webp',
                originalSizeKB,
                compressedSizeKB: Math.max(1, Math.round(webpBlob.size / 1024)),
                previewUrl,
              });
            } else {
              canvas.toBlob(
                (jpegBlob) => {
                  URL.revokeObjectURL(objectUrl);
                  if (!jpegBlob) {
                    reject(new Error('Greška pri kompresiji slike računa.'));
                    return;
                  }
                  const previewUrl = URL.createObjectURL(jpegBlob);
                  resolve({
                    blob: jpegBlob,
                    fileName: `${baseName}.jpg`,
                    mimeType: 'image/jpeg',
                    originalSizeKB,
                    compressedSizeKB: Math.max(1, Math.round(jpegBlob.size / 1024)),
                    previewUrl,
                  });
                },
                'image/jpeg',
                quality
              );
            }
          },
          'image/webp',
          quality
        );
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Nije moguće učitati izabranu fotografiju računa.'));
    };

    img.src = objectUrl;
  });
}

