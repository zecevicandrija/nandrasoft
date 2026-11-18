import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import MachineUsageAction from '../components/MachineUsageAction';
import WorkMaterialsEditor from '../components/WorkMaterialsEditor';
import { ContractorSelect } from '../components/ContractorSelect';
import { ParcelQuickActions, ParcelQuickModal, type ParcelItem } from '../components/ParcelQuickModal';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import { materialPayload, type MaterialKind, type WorkMaterial } from '../lib/workMaterials';
import styles from './Radovi.module.css';

export interface FieldWorkAssignmentItem {
  id?: string;
  areaDoneHa?: number | null;
  machine?: { id?: string; name: string } | null;
}

export interface FieldWorkItem {
  id: string;
  date: string;
  shift: string;
  parcelId: string;
  contractorId?: string | null;
  machineId: string;
  attachmentId?: string | null;
  workerId: string;
  workTypeId: string;
  areaDoneHa: number;
  workHours?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  status: string;
  notes?: string | null;
  photoUrl?: string | null;
  materials?: WorkMaterial[];
  parcel?: { id?: string; code?: string; name: string; areaHa?: number } | null;
  contractor?: { id?: string; name: string } | null;
  worker?: { id: string; name: string } | null;
  machine?: { id?: string; name: string } | null;
  attachment?: { id?: string; name: string } | null;
  workType?: { id?: string; name: string } | null;
  workOrder?: { id?: string } | null;
  machineAssignments?: FieldWorkAssignmentItem[] | null;
}

export interface MachineOption {
  id: string;
  name: string;
  type?: string | null;
  brandModel?: string | null;
}

export interface WorkerOption {
  id: string;
  name: string;
  type?: string | null;
  role?: string | null;
}

export interface WorkTypeOption {
  id: string;
  name: string;
  category?: string | null;
  materialKind?: MaterialKind | null;
  materialRequired?: boolean;
}

export interface EditWorkFormState {
  date: string;
  shift: string;
  parcelId: string;
  contractorId: string | null;
  materials: WorkMaterial[];
  machineId: string;
  attachmentId: string;
  workerId: string;
  workTypeId: string;
  areaDoneHa: string | number;
  startTime: string;
  endTime: string;
  notes: string;
}

export interface EditWorkSubmitPayload extends Omit<EditWorkFormState, 'areaDoneHa' | 'materials' | 'attachmentId'> {
  areaDoneHa: number;
  materials: ReturnType<typeof materialPayload>;
  attachmentId: string | null;
}

interface EditWorkModalProps {
  editingWork: FieldWorkItem;
  parcels: ParcelItem[];
  machines: MachineOption[];
  workers: WorkerOption[];
  workTypes: WorkTypeOption[];
  isManager: boolean;
  isOperator: boolean;
  isSaving: boolean;
  onClose: () => void;
  onOpenMachineUsage: (workId: string) => void;
  onNotify: (message: string, type: 'success' | 'error') => void;
  onSubmit: (id: string, data: EditWorkSubmitPayload) => void;
}

const SHIFT_OPTIONS: CustomSelectOption[] = [
  { value: 'PRVA', label: '1. Smena (Jutarnja)' },
  { value: 'DRUGA', label: '2. Smena (Popodnevna)' },
  { value: 'TRECA', label: '3. Smena (Noćna)' },
];

export const EditWorkModal: React.FC<EditWorkModalProps> = ({
  editingWork,
  parcels,
  machines,
  workers,
  workTypes,
  isManager,
  isOperator,
  isSaving,
  onClose,
  onOpenMachineUsage,
  onNotify,
  onSubmit,
}) => {
  const [editForm, setEditForm] = useState<EditWorkFormState>(() => ({
    date: editingWork.date ? new Date(editingWork.date).toISOString().slice(0, 10) : '',
    shift: editingWork.shift,
    parcelId: editingWork.parcelId,
    contractorId: editingWork.contractorId || null,
    materials: editingWork.materials ?? [],
    machineId: editingWork.machineId,
    attachmentId: editingWork.attachmentId || '',
    workerId: editingWork.workerId,
    workTypeId: editingWork.workTypeId,
    areaDoneHa: editingWork.areaDoneHa,
    startTime: editingWork.startTime || '',
    endTime: editingWork.endTime || '',
    notes: editingWork.notes || '',
  }));

  const [parcelQuickModalOpen, setParcelQuickModalOpen] = useState(false);
  const [parcelToEdit, setParcelToEdit] = useState<ParcelItem | null>(null);

  const parcelEditOptions: CustomSelectOption[] = useMemo(() => {
    return parcels.map((p) => ({
      value: p.id,
      label: `[${p.code}] ${p.name}`,
      subLabel: `${p.areaHa} ha${p.currentCrop ? ` • ${p.currentCrop}` : ''}`,
    }));
  }, [parcels]);

  const machineEditOptions: CustomSelectOption[] = useMemo(() => {
    return machines
      .filter((m) => m.type !== 'PRIKLJUCAK' || m.id === editForm.machineId)
      .map((m) => ({
        value: m.id,
        label: m.name,
        subLabel: [m.type, m.brandModel].filter(Boolean).join(' • ') || undefined,
      }));
  }, [machines, editForm.machineId]);

  const workerEditOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = workers.map((w) => ({
      value: w.id,
      label: w.name,
      subLabel: w.type || w.role || undefined,
    }));
    const workWorker = editingWork.worker;
    if (workWorker && !list.some((w) => w.value === workWorker.id)) {
      list.unshift({ value: workWorker.id, label: workWorker.name });
    }
    return list;
  }, [workers, editingWork.worker]);

  const attachmentEditOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = machines
      .filter((m) => m.type === 'PRIKLJUCAK' || m.id === editForm.attachmentId)
      .map((m) => ({
        value: m.id,
        label: m.name,
        subLabel: m.brandModel || 'Priključno oruđe',
      }));
    return [
      { value: '', label: '— Bez priključka —', subLabel: 'Samostalan rad mašine bez oruđa' },
      ...list,
    ];
  }, [machines, editForm.attachmentId]);

  const workTypeEditOptions: CustomSelectOption[] = useMemo(() => {
    return workTypes.map((wt) => ({
      value: wt.id,
      label: wt.name,
      subLabel: wt.category || undefined,
    }));
  }, [workTypes]);

  const selectedWorkType = useMemo(
    () => workTypes.find((w) => w.id === editForm.workTypeId),
    [workTypes, editForm.workTypeId]
  );

  const selectedParcelObj = useMemo(
    () => parcels.find((p) => p.id === editForm.parcelId) || null,
    [parcels, editForm.parcelId]
  );

  const hasLinkedExecution = Boolean(editingWork.workOrder || editingWork.machineAssignments?.length);

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editForm.parcelId || !editForm.machineId || !editForm.workerId || !editForm.workTypeId) {
      onNotify('Molimo izaberite sva obavezna polja (parcela, mašina, radnik, operacija).', 'error');
      return;
    }

    onSubmit(editingWork.id, {
      ...editForm,
      areaDoneHa: Number(editForm.areaDoneHa),
      materials: materialPayload(editForm.materials),
      attachmentId: editForm.attachmentId || null,
    });
  };

  return (
    <>
      <div className={styles.modalOverlay} onClick={onClose}>
        <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <h3 className={styles.modalTitle}>Izmena Zapisa o Radu</h3>
            <button className={styles.modalCloseBtn} onClick={onClose}>
              <X size={20} />
            </button>
          </div>

          <MachineUsageAction inset onClick={() => onOpenMachineUsage(editingWork.id)} />
          <form onSubmit={handleSaveEdit}>
            <div className={styles.modalBody}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>
                    Datum rada {isOperator && '(fiksiran na dan unosa)'}
                  </label>
                  <input
                    type="date"
                    className={styles.selectInput}
                    value={editForm.date}
                    onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                    disabled={isOperator || hasLinkedExecution}
                    required
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Smena</label>
                  <CustomSelect
                    value={editForm.shift}
                    onChange={(val) => setEditForm({ ...editForm, shift: val })}
                    options={SHIFT_OPTIONS}
                    searchable={false}
                  />
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                    <label className={styles.formLabel} style={{ marginBottom: 0 }}>Parcela</label>
                    {isManager && (
                      <ParcelQuickActions
                        selectedParcel={selectedParcelObj}
                        onAddClick={() => {
                          setParcelToEdit(null);
                          setParcelQuickModalOpen(true);
                        }}
                        onEditClick={(parcel) => {
                          setParcelToEdit(parcel);
                          setParcelQuickModalOpen(true);
                        }}
                      />
                    )}
                  </div>
                  <CustomSelect
                    value={editForm.parcelId}
                    disabled={hasLinkedExecution}
                    onChange={(val) => setEditForm({ ...editForm, parcelId: val })}
                    options={parcelEditOptions}
                    placeholder="— Izaberite parcelu —"
                    searchable
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Urađena površina (ha)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    className={styles.selectInput}
                    value={editForm.areaDoneHa}
                    disabled={Boolean(editingWork.machineAssignments?.length)}
                    onChange={(e) => setEditForm({ ...editForm, areaDoneHa: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Mašina / Traktor</label>
                  <CustomSelect
                    value={editForm.machineId}
                    disabled
                    onChange={(val) => setEditForm({ ...editForm, machineId: val })}
                    options={machineEditOptions}
                    placeholder="— Izaberite mašinu —"
                    searchable
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>
                    Radnik {isOperator && '(automatski vezan nalog)'}
                  </label>
                  <CustomSelect
                    value={editForm.workerId}
                    onChange={(val) => setEditForm({ ...editForm, workerId: val })}
                    options={workerEditOptions}
                    placeholder="— Izaberite radnika —"
                    disabled={isOperator || hasLinkedExecution}
                    searchable
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <ContractorSelect
                  value={editForm.contractorId || ''}
                  onChange={(value) => setEditForm({ ...editForm, contractorId: value || null })}
                  canManage={isManager}
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Priključak / Oruđe (opciono)</label>
                <CustomSelect
                  value={editForm.attachmentId || ''}
                  onChange={(val) => setEditForm({ ...editForm, attachmentId: val })}
                  options={attachmentEditOptions}
                  placeholder="— Bez priključka —"
                  searchable
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Radna operacija</label>
                <CustomSelect
                  value={editForm.workTypeId}
                  disabled={hasLinkedExecution}
                  onChange={(val) =>
                    setEditForm({
                      ...editForm,
                      workTypeId: val,
                      materials: val === editForm.workTypeId ? editForm.materials : [],
                    })
                  }
                  options={workTypeEditOptions}
                  placeholder="— Izaberite radnu operaciju —"
                  searchable
                />
              </div>

              <WorkMaterialsEditor
                kind={selectedWorkType?.materialKind}
                required={selectedWorkType?.materialRequired}
                value={editForm.materials}
                onChange={(materials) => setEditForm({ ...editForm, materials })}
                canManage={isManager}
              />

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Početak rada (HH:MM)</label>
                  <input
                    type="time"
                    className={styles.selectInput}
                    value={editForm.startTime}
                    onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Kraj rada (HH:MM)</label>
                  <input
                    type="time"
                    className={styles.selectInput}
                    value={editForm.endTime}
                    onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })}
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Napomena</label>
                <textarea
                  rows={3}
                  className={styles.selectInput}
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  placeholder="Uneti zapažanja, uslove na njivi ili specifičnosti..."
                />
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>
                Otkaži
              </button>
              <button type="submit" className={styles.btnPrimary} disabled={isSaving}>
                {isSaving ? 'Čuvanje...' : 'Sačuvaj Izmene'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <ParcelQuickModal
        isOpen={parcelQuickModalOpen}
        onClose={() => setParcelQuickModalOpen(false)}
        parcelToEdit={parcelToEdit}
        onSaved={(savedParcel, mode) => {
          setEditForm((prev) => ({ ...prev, parcelId: savedParcel.id }));
          onNotify(
            mode === 'edit'
              ? `Parcela [${savedParcel.code}] ${savedParcel.name} je izmenjena.`
              : `Nova parcela [${savedParcel.code}] ${savedParcel.name} je dodata.`,
            'success'
          );
        }}
      />
    </>
  );
};
