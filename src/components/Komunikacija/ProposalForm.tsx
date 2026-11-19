import { useQuery } from '@tanstack/react-query';
import { PackingFields, newPackingPlan } from '../../Luk/PackingFields';
import { onionRequest } from '../../Luk/onionRequest';
import QueryErrorNotice from '../QueryErrorNotice';
import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ClipboardList,
  Loader2,
  Save,
  X,
} from 'lucide-react';
import { CustomSelect, type CustomSelectOption } from '../../Djubrivo/CustomSelect';
import { ContractorSelect } from '../ContractorSelect';
import { PhotoUpload } from '../PhotoUpload';
import WorkMaterialsEditor from '../WorkMaterialsEditor';
import { materialPayload, type WorkMaterial } from '../../lib/workMaterials';
import { filterWorkersForOrderType } from './ConvertProposalModal';
import { machineTypeLabels, type Catalog, type Named, type ProposalData } from './types';
import styles from './Komunikacija.module.css';

function emptyProposal(): ProposalData {
  const date = new Date();
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
  return {
    title: '',
    orderDate: localDate,
    orderType: 'RAD_NJIVA',
    serviceType: null,
    workerId: null,
    machineId: null,
    attachmentId: null,
    contractorId: null,
    parcelId: null,
    workTypeId: null,
    shift: 'PRVA',
    priority: 'NORMALNO',
    plannedAreaHa: null,
    materials: '',
    workMaterials: [],
    instructions: '',
    photoUrl: null,
  };
}

const ORDER_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: 'PAKOVANJE', label: 'Pakovanje', subLabel: 'Sortiranje i pakovanje luka u magacinu' },
  {
    value: 'RAD_NJIVA',
    label: 'Rad na njivi',
    subLabel: 'Obrada, setva, zaštita, đubrenje, berba',
  },
  {
    value: 'REMONT_SERVIS',
    label: 'Remont / servis',
    subLabel: 'Radionica, popravke i održavanje mašina',
  },
];

const SHIFT_OPTIONS: CustomSelectOption[] = [
  { value: 'PRVA', label: '1. smena (Jutarnja)', subLabel: '07:00 – 15:30' },
  { value: 'DRUGA', label: '2. smena (Popodnevna)', subLabel: '15:30 – 23:00' },
  { value: 'TRECA', label: '3. smena (Noćna)', subLabel: '23:00 – 07:00' },
];

const PRIORITY_OPTIONS: CustomSelectOption[] = [
  {
    value: 'NORMALNO',
    label: 'Normalno',
    subLabel: 'Standardan prioritet realizacije',
    badge: 'Normalno',
    badgeType: 'default',
  },
  {
    value: 'HITNO',
    label: 'Hitno',
    subLabel: 'Povišen prioritet — izvršiti što pre',
    badge: 'Hitno',
    badgeType: 'warning',
  },
  {
    value: 'KRITICNO',
    label: 'Kritično',
    subLabel: 'Urgentno — zahteva hitnu pažnju',
    badge: 'Kritično',
    badgeType: 'danger',
    isAlert: true,
  },
];

const SERVICE_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: 'REDOVAN_SERVIS', label: 'Redovan servis (zamena ulja/filtera)', badge: 'REDOVAN' },
  { value: 'GENERALNI_REMONT', label: 'Generalni remont mehanizacije', badge: 'REMONT' },
  { value: 'KVAR_NJIVA', label: 'Vanredni kvar sa terena/njive', badge: 'KVAR', badgeType: 'danger' },
];

const REMONT_PRIORITY_OPTIONS: CustomSelectOption[] = [
  { value: 'KRITICNA', label: 'Kritičan prioritet', badge: 'KRITIČNO', badgeType: 'danger', isAlert: true },
  { value: 'VISOKA', label: 'Visok prioritet', badge: 'VISOK', badgeType: 'warning' },
  { value: 'SREDNJA', label: 'Srednji prioritet', badge: 'SREDNJI', badgeType: 'default' },
  { value: 'NISKA', label: 'Nizak prioritet', badge: 'NIZAK', badgeType: 'default' },
];

const toRemontPriority = (priority?: string) => {
  if (priority === 'KRITICNO' || priority === 'KRITICNA') return 'KRITICNA';
  if (priority === 'HITNO' || priority === 'VISOKA') return 'VISOKA';
  if (priority === 'SREDNJA') return 'SREDNJA';
  if (priority === 'NISKA') return 'NISKA';
  return 'VISOKA';
};

const toStandardPriority = (priority?: string) => {
  if (priority === 'KRITICNA' || priority === 'KRITICNO') return 'KRITICNO';
  if (priority === 'VISOKA' || priority === 'HITNO') return 'HITNO';
  return 'NORMALNO';
};

function buildCatalogOptions(
  items: Named[],
  currentValue: string | null,
  fallbackLabel: string | undefined,
  emptySubLabel: string,
  subLabelFn?: (item: Named) => string | undefined,
  badgeFn?: (item: Named) => string | undefined
): CustomSelectOption[] {
  const options: CustomSelectOption[] = [
    {
      value: '',
      label: 'Još nije određeno',
      subLabel: emptySubLabel,
    },
  ];

  if (currentValue && !items.some((item) => item.id === currentValue)) {
    options.push({
      value: currentValue,
      label: fallbackLabel || 'Neaktivan izbor',
      subLabel: 'Stavka više nije aktivna u šifarniku',
      badge: 'Neaktivan',
      isAlert: true,
    });
  }

  for (const item of items) {
    options.push({
      value: item.id,
      label: item.name,
      subLabel: subLabelFn ? subLabelFn(item) : undefined,
      badge: badgeFn ? badgeFn(item) : undefined,
      badgeType: 'default',
    });
  }

  return options;
}

interface ProposalFormProps {
  initial?: ProposalData;
  catalog?: Catalog;
  catalogLoading?: boolean;
  busy: boolean;
  error?: string;
  onSave: (data: ProposalData) => void;
  onCancel: () => void;
}

export default function ProposalForm({
  initial,
  catalog,
  catalogLoading = false,
  busy,
  error,
  onSave,
  onCancel,
}: ProposalFormProps) {
  const [data, setData] = useState<ProposalData>(() =>
    initial
      ? {
          ...emptyProposal(),
          ...initial,
          priority:
            initial.orderType === 'REMONT_SERVIS'
              ? toRemontPriority(initial.priority)
              : toStandardPriority(initial.priority),
          serviceType:
            initial.orderType === 'REMONT_SERVIS'
              ? initial.serviceType || 'REDOVAN_SERVIS'
              : null,
        }
      : emptyProposal()
  );
  const [workMaterials, setWorkMaterials] = useState<WorkMaterial[]>(
    () => initial?.labels?.workMaterials || []
  );
  const [photoUploading, setPhotoUploading] = useState(false);

  const isPacking = data.orderType === 'PAKOVANJE';
  const lots = useQuery({
    queryKey: ['onion-lookup'],
    queryFn: ({ signal }) => onionRequest('/lookup', signal),
    enabled: isPacking,
  });
  const isRemont = data.orderType === 'REMONT_SERVIS';
  const field = <K extends keyof ProposalData>(key: K, value: ProposalData[K]) =>
    setData((current) => ({ ...current, [key]: value }));

  const selectedWorkType = useMemo(
    () => catalog?.workTypes.find((wt) => wt.id === data.workTypeId),
    [catalog?.workTypes, data.workTypeId]
  );

  const workerOptions = useMemo(() => {
    const filteredWorkers = filterWorkersForOrderType(catalog?.workers || [], data.orderType);
    return buildCatalogOptions(
      filteredWorkers,
      data.orderType === 'PAKOVANJE' ? null : data.workerId,
      data.labels?.workerId,
      isRemont ? 'Mehaničar može biti određen i kasnije' : 'Radnik može biti određen i kasnije'
    );
  }, [catalog?.workers, data.orderType, data.workerId, data.labels?.workerId, isRemont]);

  const remontMachineOptions = useMemo<CustomSelectOption[]>(() => {
    const list: CustomSelectOption[] = (catalog?.machines || []).map((item) => {
      const bType: CustomSelectOption['badgeType'] =
        item.status === 'U_KVARU'
          ? 'danger'
          : item.status === 'SERVIS'
            ? 'warning'
            : item.status === 'SLOBODNA'
              ? 'success'
              : 'default';
      const typeLabel = item.type ? machineTypeLabels[item.type] || item.type : 'Mašina';
      return {
        value: item.id,
        label: item.name,
        subLabel: `${item.brandModel || typeLabel}${item.status ? ` • Trenutno: ${item.status}` : ''}`,
        badge: item.status || typeLabel,
        badgeType: bType,
      };
    });
    if (data.machineId && !list.some((item) => item.value === data.machineId)) {
      list.unshift({
        value: data.machineId,
        label: data.labels?.machineId || 'Neaktivan izbor',
        subLabel: 'Stavka više nije aktivna u šifarniku',
        badge: 'Neaktivan',
        badgeType: 'danger',
        isAlert: true,
      });
    }
    return list;
  }, [catalog?.machines, data.machineId, data.labels?.machineId]);

  const machineOptions = useMemo(
    () =>
      buildCatalogOptions(
        (catalog?.machines || []).filter((item) => item.type !== 'PRIKLJUCAK'),
        data.machineId,
        data.labels?.machineId,
        'Bez pogonske mašine ili naknadno',
        (item) => (item.type ? machineTypeLabels[item.type] || item.type : undefined),
        (item) => (item.type ? machineTypeLabels[item.type] || item.type : undefined)
      ),
    [catalog?.machines, data.machineId, data.labels?.machineId]
  );

  const attachmentOptions = useMemo(
    () =>
      buildCatalogOptions(
        (catalog?.machines || []).filter((item) => item.type === 'PRIKLJUCAK'),
        data.attachmentId,
        data.labels?.attachmentId,
        'Bez priključnog oruđa'
      ),
    [catalog?.machines, data.attachmentId, data.labels?.attachmentId]
  );

  const parcelOptions = useMemo(
    () =>
      buildCatalogOptions(
        catalog?.parcels || [],
        data.parcelId,
        data.labels?.parcelId,
        'Parcela nije određena'
      ),
    [catalog?.parcels, data.parcelId, data.labels?.parcelId]
  );

  const workTypeOptions = useMemo(
    () =>
      buildCatalogOptions(
        catalog?.workTypes || [],
        data.workTypeId,
        data.labels?.workTypeId,
        'Radna operacija nije određena'
      ),
    [catalog?.workTypes, data.workTypeId, data.labels?.workTypeId]
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || photoUploading || !catalog) return;
    if (isRemont && (!data.machineId || data.instructions.trim().length < 3)) return;
    const payload: ProposalData = isRemont
      ? {
          ...data,
          serviceType: data.serviceType || 'REDOVAN_SERVIS',
          shift: 'PRVA',
          attachmentId: null,
          contractorId: null,
          parcelId: null,
          workTypeId: null,
          plannedAreaHa: null,
          materials: '',
          workMaterials: [],
          photoUrl: data.photoUrl || null,
        }
      : {
          ...data,
          serviceType: null,
          workerId: isPacking && !workerOptions.some(option => option.value === data.workerId) ? null : data.workerId,
          contractorId: data.orderType === 'RAD_NJIVA' ? (data.contractorId || null) : null,
          workMaterials: data.orderType === 'RAD_NJIVA' ? materialPayload(workMaterials) : [],
          photoUrl: data.photoUrl || null,
        };
    delete payload.labels;
    onSave(payload);
  };

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="proposal-modal-title"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 id="proposal-modal-title">
            <ClipboardList size={20} color="#16a34a" />
            <span>{initial ? 'Izmena predloga naloga' : 'Novi predlog radnog naloga'}</span>
          </h3>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onCancel}
            disabled={busy}
            aria-label="Zatvori prozor"
          >
            <X size={20} />
          </button>
        </div>

        <form className={styles.modalForm} onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            <p className={styles.subtitle}>
              Predlog služi usaglašavanju direktora pre izrade naloga. Odobrenje se odnosi na
              poslednji sačuvani sadržaj.
            </p>

            {error && (
              <div className={styles.errorBanner} role="alert">
                <div className={styles.errorBannerLeft}>
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              </div>
            )}

            {catalogLoading || !catalog ? (
              <div className={styles.emptyState}>
                <Loader2 size={30} className={styles.spinIcon} color="#16a34a" />
                <span className={styles.emptyTitle}>Učitavanje šifarnika...</span>
              </div>
            ) : (
              <>
                <div className={styles.formGrid}>
                  <div className={`${styles.formField} ${styles.formFieldFull}`}>
                    <label htmlFor="proposal-title">Naziv predloga *</label>
                    <input
                      id="proposal-title"
                      className={styles.formInput}
                      required
                      maxLength={160}
                      placeholder={
                        isRemont
                          ? 'npr. Zamena ulja i filtera — John Deere 6155M'
                          : isPacking ? 'npr. Pakovanje luka za isporuku' : 'npr. Prihrana pšenice — Tabla 4'
                      }
                      value={data.title}
                      onChange={(e) => field('title', e.target.value)}
                    />
                  </div>

                  <div className={styles.formField}>
                    <label htmlFor="proposal-order-type">Tip posla</label>
                    <CustomSelect
                      id="proposal-order-type"
                      value={data.orderType}
                      onChange={(val) => {
                        const filtered = filterWorkersForOrderType(catalog?.workers || [], val);
                        const isValidWorker =
                          data.workerId && filtered.some((worker) => worker.id === data.workerId);
                        if (val !== 'RAD_NJIVA') {
                          setWorkMaterials([]);
                        }
                        setData((current) => ({
                          ...current,
                          orderType: val,
                          packingPlan: val === 'PAKOVANJE' ? current.packingPlan ?? newPackingPlan(current.orderDate) : undefined,
                          machineId: val === 'PAKOVANJE' ? null : current.machineId,
                          priority:
                            val === 'REMONT_SERVIS'
                              ? current.orderType !== 'REMONT_SERVIS' && current.priority === 'NORMALNO'
                                ? 'VISOKA'
                                : toRemontPriority(current.priority)
                              : toStandardPriority(current.priority),
                          serviceType:
                            val === 'REMONT_SERVIS'
                              ? current.serviceType || 'REDOVAN_SERVIS'
                              : null,
                          contractorId: val === 'RAD_NJIVA' ? current.contractorId || null : null,
                          parcelId: val === 'RAD_NJIVA' ? current.parcelId : null,
                          attachmentId: val === 'RAD_NJIVA' ? current.attachmentId : null,
                          workTypeId: val === 'RAD_NJIVA' ? current.workTypeId : null,
                          plannedAreaHa: val === 'RAD_NJIVA' ? current.plannedAreaHa : null,
                          materials: val === 'RAD_NJIVA' ? current.materials : '',
                          shift: val === 'REMONT_SERVIS' ? 'PRVA' : current.shift,
                          workerId: isValidWorker ? current.workerId : null,
                        }));
                      }}
                      options={ORDER_TYPE_OPTIONS}
                      searchable={false}
                    />
                  </div>

                  {isRemont ? (
                    <>
                      <div className={styles.formField}>
                        <label htmlFor="proposal-date">Datum planiranog početka *</label>
                        <input
                          id="proposal-date"
                          className={styles.formInput}
                          required
                          type="date"
                          value={data.orderDate}
                          onChange={(e) => field('orderDate', e.target.value)}
                        />
                      </div>

                      <div className={`${styles.formField} ${styles.formFieldFull}`}>
                        <label htmlFor="proposal-machine">Mašina ili priključak za remont *</label>
                        <CustomSelect
                          id="proposal-machine"
                          value={data.machineId || ''}
                          onChange={(val) => field('machineId', val || null)}
                          options={remontMachineOptions}
                          placeholder="Izaberite mašinu za remont..."
                        />
                      </div>

                      <div className={`${styles.formField} ${styles.formFieldFull}`}>
                        <label htmlFor="proposal-worker">Dodeljeni mehaničar / serviser</label>
                        <CustomSelect
                          id="proposal-worker"
                          value={data.workerId || ''}
                          onChange={(val) => field('workerId', val || null)}
                          options={workerOptions}
                          placeholder="Izaberite mehaničara..."
                        />
                      </div>

                      <div className={styles.formField}>
                        <label htmlFor="proposal-service-type">Tip servisa *</label>
                        <CustomSelect
                          id="proposal-service-type"
                          value={data.serviceType || 'REDOVAN_SERVIS'}
                          onChange={(val) => field('serviceType', val)}
                          options={SERVICE_TYPE_OPTIONS}
                          searchable={false}
                        />
                      </div>

                      <div className={styles.formField}>
                        <label htmlFor="proposal-priority">Prioritet *</label>
                        <CustomSelect
                          id="proposal-priority"
                          value={data.priority}
                          onChange={(val) => field('priority', val)}
                          options={REMONT_PRIORITY_OPTIONS}
                          searchable={false}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      {!isPacking && (
                        <div className={styles.formField}>
                        <label htmlFor="proposal-date">Planirani datum *</label>
                        <input
                          id="proposal-date"
                          className={styles.formInput}
                          required
                          type="date"
                          value={data.orderDate}
                          onChange={(e) => field('orderDate', e.target.value)}
                        />
                        </div>
                      )}

                      <div className={styles.formField}>
                        <label htmlFor="proposal-shift">Smena</label>
                        <CustomSelect
                          id="proposal-shift"
                          value={data.shift}
                          onChange={(val) => field('shift', val)}
                          options={SHIFT_OPTIONS}
                          searchable={false}
                        />
                      </div>

                      <div className={styles.formField}>
                        <label htmlFor="proposal-priority">Prioritet</label>
                        <CustomSelect
                          id="proposal-priority"
                          value={data.priority}
                          onChange={(val) => field('priority', val)}
                          options={PRIORITY_OPTIONS}
                          searchable={false}
                        />
                      </div>

                      <div className={styles.formField}>
                        <label htmlFor="proposal-worker">Radnik</label>
                        <CustomSelect
                          id="proposal-worker"
                          value={data.workerId || ''}
                          onChange={(val) => field('workerId', val || null)}
                          options={workerOptions}
                          placeholder="— Izaberite radnika —"
                        />
                      </div>

                      {!isPacking && (<>
                        <div className={styles.formField}>
                          <label htmlFor="proposal-parcel">Parcela</label>
                          <CustomSelect
                            id="proposal-parcel"
                            value={data.parcelId || ''}
                            onChange={(val) => field('parcelId', val || null)}
                            options={parcelOptions}
                            placeholder="— Izaberite parcelu —"
                          />
                        </div>

                        <div className={styles.formField}>
                          <label htmlFor="proposal-machine">Mašina</label>
                          <CustomSelect
                            id="proposal-machine"
                            value={data.machineId || ''}
                            onChange={(val) => field('machineId', val || null)}
                            options={machineOptions}
                            placeholder="— Izaberite mašinu —"
                          />
                        </div>

                        <div className={styles.formField}>
                          <label htmlFor="proposal-attachment">Priključak</label>
                          <CustomSelect
                            id="proposal-attachment"
                            value={data.attachmentId || ''}
                            onChange={(val) => field('attachmentId', val || null)}
                            options={attachmentOptions}
                            placeholder="— Izaberite priključak —"
                          />
                        </div>

                        {data.orderType === 'RAD_NJIVA' && (
                          <div className={`${styles.formField} ${styles.formFieldFull}`}>
                            <ContractorSelect
                              value={data.contractorId || ''}
                              onChange={(val) => field('contractorId', val || null)}
                              canManage={true}
                            />
                          </div>
                        )}

                        <div className={styles.formField}>
                          <label htmlFor="proposal-work-type">Vrsta rada</label>
                          <CustomSelect
                            id="proposal-work-type"
                            value={data.workTypeId || ''}
                            onChange={(val) => {
                              const nextId = val || null;
                              if (nextId !== data.workTypeId) {
                                setWorkMaterials([]);
                              }
                              field('workTypeId', nextId);
                            }}
                            options={workTypeOptions}
                            placeholder="— Izaberite vrstu rada —"
                          />
                        </div>

                        <div className={styles.formField}>
                          <label htmlFor="proposal-area">Planirana površina (ha)</label>
                          <input
                            id="proposal-area"
                            className={styles.formInput}
                            type="number"
                            min="0.01"
                            step="0.01"
                            max="100000"
                            placeholder="npr. 12.5"
                            value={data.plannedAreaHa ?? ''}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (!raw) {
                                field('plannedAreaHa', null);
                                return;
                              }
                              const parsed = Number(raw);
                              field('plannedAreaHa', Number.isFinite(parsed) ? parsed : null);
                            }}
                          />
                        </div>
                      </>)}
                    </>
                  )}
                </div>

                {!isRemont && data.orderType === 'RAD_NJIVA' && selectedWorkType?.materialKind && (
                  <div className={styles.formField}>
                    <WorkMaterialsEditor
                      kind={selectedWorkType.materialKind}
                      required={Boolean(selectedWorkType.materialRequired)}
                      value={workMaterials}
                      onChange={setWorkMaterials}
                      canManage={true}
                    />
                  </div>
                )}

                {isPacking && data.packingPlan && <>
                  {lots.isError && <QueryErrorNotice title="Učitavanje LOT-ova nije uspelo." error={lots.error}
                    pending={lots.isFetching} onRetry={() => void lots.refetch()} />}
                  <PackingFields plan={data.packingPlan} allSelectableLots={lots.data?.allLots || []}
                    onChange={update => setData(current => {
                      const plan = current.packingPlan;
                      if (!plan) return current;
                      const packingPlan = typeof update === 'function' ? update(plan) : update;
                      return { ...current, packingPlan, orderDate: packingPlan.packagingForm.date };
                    })} />
                </>}

                {!isRemont && !isPacking && (
                  <div className={styles.formField}>
                    <label htmlFor="proposal-materials">Predlog materijala i količina (napomena)</label>
                    <textarea
                      id="proposal-materials"
                      className={styles.formTextarea}
                      maxLength={3000}
                      value={data.materials}
                      onChange={(e) => field('materials', e.target.value)}
                      placeholder="Navedite đubriva, hemiju, seme, doze i procenjene količine za dogovor..."
                    />
                  </div>
                )}

                <div className={styles.formField}>
                  <label htmlFor="proposal-instructions">
                    {isRemont
                      ? 'Uputstvo i specifikacija posla za mehaničara *'
                      : 'Uputstvo i napomene'}
                  </label>
                  <textarea
                    id="proposal-instructions"
                    className={styles.formTextarea}
                    maxLength={5000}
                    required={isRemont}
                    value={data.instructions}
                    onChange={(e) => field('instructions', e.target.value)}
                    placeholder={
                      isRemont
                        ? 'Npr. Generalni remont ulagača semena, zamena ulja u menjaču i provera zaptivača...'
                        : 'Detaljnije instrukcije za izvršenje posla, uslove na terenu ili napomene...'
                    }
                  />
                </div>

                <div className={styles.formField}>
                  <PhotoUpload
                    photoUrl={data.photoUrl || null}
                    label="Fotografija za radnika (opciono)"
                    onChange={(photoUrl) => field('photoUrl', photoUrl)}
                    onUploadStateChange={setPhotoUploading}
                    disabled={busy}
                  />
                </div>

                {initial && (
                  <div className={styles.modalWarnNote}>
                    <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                    <span>
                      Čuvanje izmene vraća predlog u status &bdquo;Nacrt&ldquo; i zahteva ponovno
                      slanje na pregled i odobrenje.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          <div className={styles.modalFooter}>
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={busy}
              onClick={onCancel}
            >
              Odustani
            </button>
            <button
              type="submit"
              className={styles.btnPrimary}
              disabled={
                busy ||
                photoUploading ||
                !catalog ||
                !data.title.trim() ||
                (isRemont && (!data.machineId || data.instructions.trim().length < 3))
              }
            >
              {busy ? (
                <>
                  <Loader2 size={16} className={styles.spinIcon} />
                  <span>Čuvanje...</span>
                </>
              ) : (
                <>
                  <Save size={16} />
                  <span>Sačuvaj nacrt</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
