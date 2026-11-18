import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Image as ImageIcon,
  CheckCircle2,
  Loader2,
  Trash2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { compressImage } from '../utils/imageCompressor';
import styles from '../Gorivo/GorivoDashboard.module.css';
import photoStyles from './PhotoAttachment.module.css';

const API = '/api';

interface PhotoUploadProps {
  photoUrl: string | null;
  onChange: (url: string | null) => void;
  onUploadStateChange?: (uploading: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export const PhotoUpload: React.FC<PhotoUploadProps> = ({
  photoUrl,
  onChange,
  onUploadStateChange,
  label = 'Fotografija (opciono)',
  disabled = false,
}) => {
  const abortRef = useRef<AbortController | null>(null);
  const uploadStateCallback = useRef(onUploadStateChange);
  uploadStateCallback.current = onUploadStateChange;
  useEffect(() => () => {
    abortRef.current?.abort();
    uploadStateCallback.current?.(false);
  }, []);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<'IDLE' | 'COMPRESSING' | 'UPLOADING' | 'DONE' | 'ERROR'>('IDLE');
  const [errorMsg, setErrorMsg] = useState('');
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  useEffect(() => () => {
    if (localPreview) URL.revokeObjectURL(localPreview);
  }, [localPreview]);

  const setUploadingState = (uploading: boolean) => {
    if (onUploadStateChange) {
      onUploadStateChange(uploading);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || disabled || isBusy) return;
    if (file.size > 32 * 1024 * 1024) {
      setErrorMsg("Fotografija može imati najviše 32 MB.");
      e.target.value = "";
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setErrorMsg('');
    setStatus('COMPRESSING');
    setUploadingState(true);

    try {
      // Prepare phone photographs on the device when supported.
      let uploadFile: Blob = file;
      let uploadName = file.name;
      try {
        const compressed = await compressImage(file, 2560, 0.88);
        uploadFile = compressed.blob;
        uploadName = compressed.fileName;
        if (controller.signal.aborted) { URL.revokeObjectURL(compressed.previewUrl); return; }
        setLocalPreview(compressed.previewUrl);
      } catch {
        // Some browsers cannot decode HEIC. Let the server convert the original.
        setLocalPreview(null);
      }

      if (controller.signal.aborted) return;
      setStatus('UPLOADING');

      // Upload through the authenticated backend; storage credentials stay on the server.
      const formData = new FormData();
      formData.append('file', uploadFile, uploadName);
      let response: Response;
      for (let attempt = 0; ; attempt++) {
        response = await fetch(`${API}/photos/upload`, {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
          body: formData,
        });
        if (response.status !== 503 || attempt >= 3) break;
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Otpremanje fotografije nije uspelo.');
      }
      const data = await response.json();
      if (controller.signal.aborted) return;
      onChange(data.fileUrl);
      setLocalPreview(null);
      setStatus('DONE');
    } catch (err: any) {
      if (controller.signal.aborted) return;
      console.error('Greška pri otpremanju fotografije:', err);
      setErrorMsg(err.message || 'Greška pri obradi ili slanju fotografije.');
      setStatus('ERROR');
    } finally {
      setUploadingState(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  const handleRemove = () => {
    onChange(null);
    setLocalPreview(null);
    setStatus('IDLE');
    setErrorMsg('');
  };

  const displayImage = localPreview || photoUrl;
  const isBusy = status === 'COMPRESSING' || status === 'UPLOADING';

  return (
    <div className={styles.receiptUploadBox}>
      <div className={styles.receiptUploadHeader}>
        <div className={styles.receiptUploadTitleRow}>
          <Camera size={16} color="#0284c7" />
          <span className={styles.receiptUploadTitle}>
            {label}
          </span>
        </div>

      </div>

      {/* Skriveni input za direktnu kameru telefona i galeriju */}
      <input
        ref={cameraInputRef}
        type="file"
        disabled={disabled || isBusy}
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
      <input
        ref={galleryInputRef}
        type="file"
        disabled={disabled || isBusy}
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {errorMsg && (
        <div className={styles.receiptErrorBox}>
          <AlertCircle size={15} />
          <span>{errorMsg}</span>
        </div>
      )}

      {isBusy ? (
        <div className={styles.receiptProgressCard}>
          <Loader2 size={22} className={styles.spinner} color="#0284c7" />
          <div>
            <div className={styles.receiptProgressTitle}>
              {status === 'COMPRESSING'
                ? 'Optimizacija i kompresija fotografije...'
                : 'Slanje fotografije...'}
            </div>
            <div className={styles.receiptProgressSub}>
              Sačekajte sekundu, slika se automatski smanjuje za brz prenos
            </div>
          </div>
        </div>
      ) : photoUrl ? (
        <div className={`${styles.receiptPreviewCard} ${photoStyles.uploadPreview}`}>
          <div className={`${styles.receiptThumbWrapper} ${photoStyles.uploadThumb}`}>
            {displayImage && (
              <img
                src={displayImage}
                alt="Priložena fotografija"
                className={styles.receiptThumbImg}
              />
            )}
          </div>
          <div className={styles.receiptPreviewInfo}>
            <div className={styles.receiptReadyBadge}>
              <CheckCircle2 size={15} />
              <span>Fotografija uspešno priložena</span>
            </div>
            <div className={styles.receiptPreviewActions}>
              <a
                href={photoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.receiptViewLink} ${photoStyles.viewLink}`}
              >
                <ExternalLink size={13} />
                <span>Pogledaj sliku</span>
              </a>
              <button
                type="button"
                disabled={disabled}
                className={styles.receiptRetakeBtn}
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera size={13} />
                <span>Slikaj ponovo</span>
              </button>
              <button
                type="button"
                disabled={disabled}
                className={styles.receiptRemoveBtn}
                onClick={handleRemove}
                title="Ukloni fotografiju"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.receiptButtonsGrid}>
          <button
            type="button"
                disabled={disabled}
            className={styles.receiptCameraBtn}
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera size={20} />
            <div className={styles.receiptBtnTextCol}>
              <span className={styles.receiptBtnMain}>Fotografiši</span>
              <span className={styles.receiptBtnSub}>Otvori kameru telefona</span>
            </div>
          </button>

          <button
            type="button"
                disabled={disabled}
            className={styles.receiptGalleryBtn}
            onClick={() => galleryInputRef.current?.click()}
          >
            <ImageIcon size={20} />
            <div className={styles.receiptBtnTextCol}>
              <span className={styles.receiptBtnMain}>Izaberi iz galerije</span>
              <span className={styles.receiptBtnSub}>Postojeća slika sa uređaja</span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
};

