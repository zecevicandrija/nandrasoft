import { useMemo, useRef, useState } from 'react';
import { Loader2, PlayCircle, X } from 'lucide-react';
import { CustomSelect } from '../../Djubrivo/CustomSelect';
import { ContractorSelect } from '../ContractorSelect';
import { PhotoUpload } from '../PhotoUpload';
import WorkMaterialsEditor from '../WorkMaterialsEditor';
import { materialPayload, type WorkMaterial } from '../../lib/workMaterials';
import styles from './Komunikacija.module.css';
import {
  orderTypeLabels,
  serviceTypeLabels,
  shiftLabels,
  type Catalog,
  type Named,
  type Proposal,
} from './types';

function buildInitialInstructions(proposal: Proposal) {
  const hasStructuredMaterials = Boolean(
    proposal.data.labels?.workMaterials?.length || proposal.data.workMaterials?.length
  );
  const parts = [
    proposal.data.title?.trim(),
    proposal.data.instructions?.trim(),
    !hasStructuredMaterials && proposal.data.materials?.trim()
      ? `Materijali: ${proposal.data.materials.trim()}`
      : '',
  ].filter(Boolean);
  return parts.join('\n').slice(0, 500);
}

export function filterWorkersForOrderType(workers: Named[], orderType: string) {
  if (orderType === 'REMONT_SERVIS') {
    return workers.filter(
      (worker) =>
        worker.role === 'MEHANICAR' ||
        worker.name.toLowerCase().includes('mehaničar') ||
        worker.name.toLowerCase().includes('mehanicar')
    );
  }
  if (orderType === 'RAD_NJIVA') {
    return workers.filter((worker) => {
      const role = worker.role;
      const isMechanic =
        role === 'MEHANICAR' ||
        worker.name.toLowerCase().includes('mehaničar') ||
        worker.name.toLowerCase().includes('mehanicar');
      const isManagement = role === 'DIREKTOR' || role === 'RUKOVODILAC';
      return !isMechanic && !isManagement;
    });
  }
  return workers;
}

export type ConvertProposalPayload = {
  version: number;
  workerId: string;
  contractorId: string | null;
  instructions: string;
  photoUrl: string | null;
  materials: ReturnType<typeof materialPayload>;
};

export function ConvertProposalModal({
  proposal,
  catalog,
  onClose,
  onConvert,
  saving,
  error,
}: {
  proposal: Proposal;
  catalog?: Catalog;
  onClose: () => void;
  onConvert: (proposal: Proposal, body: ConvertProposalPayload, idempotencyKey: string) => Promise<void>;
  saving: boolean;
  error: string | null;
}) {
  const [workerId, setWorkerId] = useState(proposal.data.workerId || '');
  const [contractorId, setContractorId] = useState(proposal.data.contractorId || '');
  const [materials, setMaterials] = useState<WorkMaterial[]>(
    () => proposal.data.labels?.workMaterials || []
  );
  const [instructions, setInstructions] = useState(() => buildInitialInstructions(proposal));
  const [photoUrl, setPhotoUrl] = useState<string | null>(proposal.data.photoUrl || null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null);

  const selectedWorkType = useMemo(
    () => catalog?.workTypes.find((wt) => wt.id === proposal.data.workTypeId),
    [catalog?.workTypes, proposal.data.workTypeId]
  );

  const eligibleWorkers = useMemo(() => {
    const filtered = filterWorkersForOrderType(catalog?.workers || [], proposal.data.orderType);
    if (workerId && !filtered.some((worker) => worker.id === workerId)) {
      const fallback = catalog?.workers.find((worker) => worker.id === workerId);
      if (fallback) return [fallback, ...filtered];
    }
    return filtered;
  }, [catalog?.workers, proposal.data.orderType, workerId]);

  const workerOptions = useMemo(
    () =>
      eligibleWorkers.map((worker) => ({
        value: worker.id,
        label: worker.name,
        badge: worker.type === 'SEZONAC' ? 'Sezonac' : undefined,
      })),
    [eligibleWorkers]
  );

  const needsMaterial =
    proposal.data.orderType === 'RAD_NJIVA' && Boolean(selectedWorkType?.materialRequired);
  const showMaterialEditor =
    proposal.data.orderType === 'RAD_NJIVA' && Boolean(selectedWorkType?.materialKind);

  const handleSubmit = async () => {
    setLocalError(null);
    if (!workerId) {
      setLocalError('Izaberite radnika pre pretvaranja u radni nalog.');
      return;
    }
    if (needsMaterial && materials.length === 0) {
      setLocalError('Ova operacija zahteva da izaberete najmanje jedan artikal materijala.');
      return;
    }
    if (uploadingPhoto) {
      setLocalError('Sačekajte da se fotografija učita pre kreiranja naloga.');
      return;
    }

    const payload: ConvertProposalPayload = {
      version: proposal.version,
      workerId,
      contractorId: proposal.data.orderType === 'RAD_NJIVA' ? contractorId || null : null,
      instructions: instructions.trim(),
      photoUrl,
      materials: proposal.data.orderType === 'RAD_NJIVA' ? materialPayload(materials) : [],
    };
    const signature = JSON.stringify({ id: proposal.id, ...payload });
    if (!idempotencyRef.current || idempotencyRef.current.signature !== signature) {
      idempotencyRef.current = {
        signature,
        key:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `convert-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      };
    }

    await onConvert(proposal, payload, idempotencyRef.current.key);
  };

  const isRemont = proposal.data.orderType === 'REMONT_SERVIS';
  const labels = proposal.data.labels || {};
  const visibleError = localError || error;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(event) => event.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <h3 className={styles.modalTitle}>Pretvori odobreni predlog u Radni nalog</h3>
            <p className={styles.modalSubtitle}>
              {proposal.data.title} · {orderTypeLabels[proposal.data.orderType] || proposal.data.orderType} ·{' '}
              {isRemont
                ? proposal.data.orderDate
                : `${proposal.data.orderDate} (${shiftLabels[proposal.data.shift] || proposal.data.shift})`}
            </p>
          </div>
          <button
            type="button"
            className={styles.modalCloseBtn}
            onClick={onClose}
            aria-label="Zatvori"
            disabled={saving}
          >
            <X size={20} />
          </button>
        </div>

        <div className={styles.modalBody}>
          {visibleError && <div className={styles.errorBanner}>{visibleError}</div>}

          <div className={styles.infoBanner}>
            Kreirani radni nalog će odmah postati vidljiv u <strong>Radnim nalozima</strong> sa statusom{' '}
            <strong>Dodeljen</strong> i poslaće obaveštenje dodeljenom radniku.
          </div>

          <div className={styles.formGrid}>
            <div className={styles.formField}>
              <label>
                {isRemont ? 'Dodeljeni mehaničar / serviser' : 'Radnik / Izvršilac'}{' '}
                <span className={styles.requiredMark}>*</span>
              </label>
              <CustomSelect
                value={workerId}
                onChange={setWorkerId}
                options={workerOptions}
                placeholder={isRemont ? 'Izaberite mehaničara...' : 'Izaberite radnika...'}
                searchable
                disabled={saving}
              />
            </div>

            {proposal.data.orderType === 'RAD_NJIVA' && (
              <div className={styles.formField}>
                <label>Kooperant (opciono)</label>
                <ContractorSelect value={contractorId} onChange={setContractorId} canManage={false} />
              </div>
            )}

            {(isRemont
              ? Boolean(labels.machineId || proposal.data.serviceType)
              : Boolean(
                  labels.machineId ||
                    labels.attachmentId ||
                    labels.parcelId ||
                    labels.workTypeId ||
                    labels.contractorId
                )) && (
              <div className={`${styles.formField} ${styles.formFieldFull}`}>
                <label>Podaci iz odobrenog predloga</label>
                <div className={styles.metaPills}>
                  {isRemont ? (
                    <>
                      {labels.machineId && (
                        <span className={`${styles.badge} ${styles.badgeInfo}`}>
                          Mašina / priključak: {labels.machineId}
                        </span>
                      )}
                      <span className={`${styles.badge} ${styles.badgeMuted}`}>
                        Tip servisa:{' '}
                        {serviceTypeLabels[proposal.data.serviceType || 'REDOVAN_SERVIS'] ||
                          proposal.data.serviceType}
                      </span>
                    </>
                  ) : (
                    <>
                      {labels.parcelId && (
                        <span className={`${styles.badge} ${styles.badgeInfo}`}>
                          Parcela: {labels.parcelId}
                        </span>
                      )}
                      {labels.workTypeId && (
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>
                          Operacija: {labels.workTypeId}
                        </span>
                      )}
                      {labels.machineId && (
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>
                          Mašina: {labels.machineId}
                        </span>
                      )}
                      {labels.attachmentId && (
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>
                          Priključak: {labels.attachmentId}
                        </span>
                      )}
                      {labels.contractorId && (
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>
                          Kooperant: {labels.contractorId}
                        </span>
                      )}
                      {proposal.data.plannedAreaHa != null && (
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>
                          Površina: {proposal.data.plannedAreaHa} ha
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {showMaterialEditor && selectedWorkType?.materialKind && (
              <div className={`${styles.formField} ${styles.formFieldFull}`}>
                <WorkMaterialsEditor
                  kind={selectedWorkType.materialKind}
                  required={needsMaterial}
                  value={materials}
                  onChange={setMaterials}
                  canManage={false}
                />
              </div>
            )}

            <div className={`${styles.formField} ${styles.formFieldFull}`}>
              <label>
                {isRemont
                  ? 'Uputstvo i specifikacija posla za mehaničara'
                  : 'Instrukcije za radni nalog'}
              </label>
              <textarea
                className={styles.formTextarea}
                rows={3}
                maxLength={500}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="Napomena, redosled radova, materijal ili dodatne instrukcije za izvršioca..."
                disabled={saving}
              />
            </div>

            <div className={`${styles.formField} ${styles.formFieldFull}`}>
              <PhotoUpload
                photoUrl={photoUrl}
                onChange={setPhotoUrl}
                onUploadStateChange={setUploadingPhoto}
                label="Prateća fotografija za nalog (opciono)"
                disabled={saving}
              />
            </div>
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={saving}>
            Otkaži
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => void handleSubmit()}
            disabled={saving || uploadingPhoto}
          >
            {saving ? <Loader2 size={16} className={styles.spinIcon} /> : <PlayCircle size={16} />}
            <span>Pretvori u Radni nalog</span>
          </button>
        </div>
      </div>
    </div>
  );
}
