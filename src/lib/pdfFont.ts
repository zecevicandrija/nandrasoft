import type jsPDF from 'jspdf';

let cachedRegularBase64: string | null = null;
let cachedBoldBase64: string | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return window.btoa(binary);
}

/**
 * Registruje i primenjuje Unicode TTF font (Roboto) u jsPDF instancu.
 * Ovo rešava problem sa nedostatkom naših slova (č, ć, đ, ž, š) i širenjem razmaka slova.
 */
export async function applyUnicodeFont(doc: jsPDF): Promise<boolean> {
  try {
    if (!cachedRegularBase64) {
      const res = await fetch('/Roboto-Regular.ttf');
      if (res.ok) {
        const buf = await res.arrayBuffer();
        cachedRegularBase64 = arrayBufferToBase64(buf);
      }
    }

    if (!cachedBoldBase64) {
      const res = await fetch('/Roboto-Bold.ttf');
      if (res.ok) {
        const buf = await res.arrayBuffer();
        cachedBoldBase64 = arrayBufferToBase64(buf);
      }
    }

    let loaded = false;
    if (cachedRegularBase64) {
      doc.addFileToVFS('Roboto-Regular.ttf', cachedRegularBase64);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      loaded = true;
    }

    if (cachedBoldBase64) {
      doc.addFileToVFS('Roboto-Bold.ttf', cachedBoldBase64);
      doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
      loaded = true;
    }

    if (loaded) {
      doc.setFont('Roboto', 'normal');
      return true;
    }
    return false;
  } catch (err) {
    console.warn('Učitavanje Roboto fonta za PDF nije uspelo, koristi se podrazumevani:', err);
    return false;
  }
}
