import React, { useRef, useState } from 'react';
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
import styles from './GorivoDashboard.module.css';

const API = 'http://localhost:5000/api';

interface SlikaRacunaUploadProps {
  receiptImageUrl: string | null;
  onChange: (url: string | null) => void;
  onUploadStateChange?: (uploading: boolean) => void;
  isWorkerOnPump?: boolean;
  hasPriceEntered?: boolean;
}

export const SlikaRacunaUpload: React.FC<SlikaRacunaUploadProps> = ({
  receiptImageUrl,
  onChange,
  onUploadStateChange,
  isWorkerOnPump = false,
  hasPriceEntered = false,
}) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<'IDLE' | 'COMPRESSING' | 'UPLOADING' | 'DONE' | 'ERROR'>('IDLE');
  const [errorMsg, setErrorMsg] = useState('');
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  const setUploadingState = (uploading: boolean) => {
    if (onUploadStateChange) {
      onUploadStateChange(uploading);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg('');
    setStatus('COMPRESSING');
    setUploadingState(true);

    try {
      // 1. Klijentska kompresija slike na telefonu/računaru (10MB -> ~180KB WebP)
      const compressed = await compressImage(file, 1600, 0.82);
      setLocalPreview(compressed.previewUrl);

      setStatus('UPLOADING');

      // Upload through the authenticated backend; storage credentials stay on the server.
      const formData = new FormData();
      formData.append('file', compressed.blob, compressed.fileName);
      const response = await fetch(`${API}/fuel/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Otpremanje slike računa nije uspelo.');
      }
      const data = await response.json();
      onChange(data.fileUrl);
      setStatus('DONE');
    } catch (err: any) {
      console.error('Greška pri otpremanju slike računa:', err);
      setErrorMsg(err.message || 'Greška pri obradi ili slanju slike računa.');
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

  const displayImage = localPreview || receiptImageUrl;
  const isBusy = status === 'COMPRESSING' || status === 'UPLOADING';

  return (
    <div className={styles.receiptUploadBox}>
      <div className={styles.receiptUploadHeader}>
        <div className={styles.receiptUploadTitleRow}>
          <Camera size={16} color="#0284c7" />
          <span className={styles.receiptUploadTitle}>
            Fotografija fiskalnog računa sa pumpe
          </span>
        </div>
        {isWorkerOnPump && (
          <span
            className={
              receiptImageUrl
                ? styles.receiptRuleBadgeOk
                : hasPriceEntered
                  ? styles.receiptRuleBadgeOptional
                  : styles.receiptRuleBadgeAction
            }
          >
            {receiptImageUrl
              ? 'Račun slikan — cena nije obavezna'
              : hasPriceEntered
                ? 'Cena uneta — slika opciona'
                : 'Slikajte račun ILI unesite cenu'}
          </span>
        )}
      </div>

      {/* Skriveni input za direktnu kameru telefona i galeriju */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
      <input
        ref={galleryInputRef}
        type="file"
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
                : 'Slanje računa na Bunny.net CDN...'}
            </div>
            <div className={styles.receiptProgressSub}>
              Sačekajte sekundu, slika se automatski smanjuje za brz prenos
            </div>
          </div>
        </div>
      ) : receiptImageUrl ? (
        <div className={styles.receiptPreviewCard}>
          <div className={styles.receiptThumbWrapper}>
            {displayImage && (
              <img
                src={displayImage}
                alt="Fiskalni račun"
                className={styles.receiptThumbImg}
              />
            )}
          </div>
          <div className={styles.receiptPreviewInfo}>
            <div className={styles.receiptReadyBadge}>
              <CheckCircle2 size={15} />
              <span>Račun uspešno priložen</span>
            </div>
            <div className={styles.receiptPreviewActions}>
              <a
                href={receiptImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.receiptViewLink}
              >
                <ExternalLink size={13} />
                <span>Pogledaj sliku</span>
              </a>
              <button
                type="button"
                className={styles.receiptRetakeBtn}
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera size={13} />
                <span>Slikaj ponovo</span>
              </button>
              <button
                type="button"
                className={styles.receiptRemoveBtn}
                onClick={handleRemove}
                title="Ukloni sliku računa"
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
            className={styles.receiptCameraBtn}
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera size={20} />
            <div className={styles.receiptBtnTextCol}>
              <span className={styles.receiptBtnMain}>Fotografiši račun</span>
              <span className={styles.receiptBtnSub}>Otvori kameru telefona</span>
            </div>
          </button>

          <button
            type="button"
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

