import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Tractor,
  CheckCircle2,
  AlertCircle,
  Clock,
  Send,
  Loader2,
  Plus,
  Info,
  User,
  KeyRound,
  ClipboardList,
  Sun,
  SunMedium,
  Moon,
  Fuel,
  AlertTriangle,
  Gauge,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import { ParcelQuickModal, ParcelQuickActions, type ParcelItem } from '../components/ParcelQuickModal';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import { useSession } from '../lib/auth-client';
import styles from './BrziUnosRada.module.css';

const API = 'http://localhost:5000/api';

const BrziUnosRada: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUser = (session as any)?.user;
  const isOperator = currentUser?.role === 'OPERATER';
  const isManager = ['DIREKTOR', 'RUKOVODILAC'].includes(currentUser?.role || '');

  // Brzo dodavanje / izmena parcele
  const [parcelQuickModalOpen, setParcelQuickModalOpen] = useState(false);
  const [parcelToEdit, setParcelToEdit] = useState<ParcelItem | null>(null);

  // Parametri prosleđeni sa Radnog Naloga
  const orderIdParam = searchParams.get('orderId');
  const parcelIdParam = searchParams.get('parcelId');
  const machineIdParam = searchParams.get('machineId');
  const attachmentIdParam = searchParams.get('attachmentId');
  const workTypeIdParam = searchParams.get('workTypeId');
  const workerIdParam = searchParams.get('workerId');

  // Form states
  const [shift, setShift] = useState<'PRVA' | 'DRUGA' | 'TRECA'>('PRVA');
  const [parcelId, setParcelId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [attachmentId, setAttachmentId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [workTypeId, setWorkTypeId] = useState('');
  const [areaDoneHa, setAreaDoneHa] = useState<number | string>('');
  const [startTime, setStartTime] = useState('07:00');
  const [endTime, setEndTime] = useState('15:30');
  const [notes, setNotes] = useState('');

  // Razduženje mašine i gorivo states
  const [endFuelLiters, setEndFuelLiters] = useState<string | number>('');
  const [endHours, setEndHours] = useState<string | number>('');
  const [isOperational, setIsOperational] = useState<boolean>(true);
  const [returnNotes, setReturnNotes] = useState('');

  // UI state
  const [errorMsg, setErrorMsg] = useState('');
  const [submittedData, setSubmittedData] = useState<any | null>(null);

  // Dohvatanje detalja radnog naloga ako je prosleđen
  const { data: orderData } = useQuery({
    queryKey: ['work-order-detail', orderIdParam],
    queryFn: async () => {
      if (!orderIdParam) return null;
      const res = await fetch(`${API}/work-orders/${orderIdParam}`, { credentials: 'include' });
      return res.ok ? res.json() : null;
    },
    enabled: !!orderIdParam,
  });

  // 1. DOHVATANJE ŠIFARNIKA
  const { data: parcelsData, isLoading: loadingParcels } = useQuery({
    queryKey: ['parcels-lite'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/parcels`, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: machinesData, isLoading: loadingMachines } = useQuery({
    queryKey: ['machines-lite'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/machines`, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: workersData, isLoading: loadingWorkers } = useQuery({
    queryKey: ['workers-lite'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/workers`, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: workTypesData, isLoading: loadingWorkTypes } = useQuery({
    queryKey: ['work-types-lite'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/work-types`, { credentials: 'include' });
      return res.json();
    },
  });

  // 2. DOHVATANJE AKTIVNIH ZADUŽENJA (PAMETNO POVEZIVANJE - REŠENJE A)
  const { data: activeAssignmentsData } = useQuery({
    queryKey: ['assignments-active'],
    queryFn: async () => {
      const res = await fetch(`${API}/assignments/active`, { credentials: 'include' });
      return res.json();
    },
  });

  // Prepoznavanje da li trenutni radnik (ili izabrani workerId) ima zadužen traktor
  const userActiveAssignment = activeAssignmentsData?.assignments?.find((a: any) => {
    if (isOperator) {
      return (
        a.createdBy?.id === currentUser?.id ||
        a.worker?.userId === currentUser?.id ||
        (currentUser?.name && a.worker?.name?.toLowerCase() === currentUser?.name?.toLowerCase())
      );
    }
    return workerId ? a.workerId === workerId : false;
  });

  // Postavi inicijalne vrednosti (prioritet ima radni nalog pa aktivno zaduženje!)
  // Ako unosimo rad ručno (bez radnog naloga i bez aktivnog zaduženja), polja ostaju prazna
  useEffect(() => {
    if (orderIdParam) {
      if (parcelIdParam) setParcelId(parcelIdParam);
      if (machineIdParam) setMachineId(machineIdParam);
      if (attachmentIdParam) setAttachmentId(attachmentIdParam);
      if (workTypeIdParam) setWorkTypeId(workTypeIdParam);
      if (workerIdParam) setWorkerId(workerIdParam);
      return;
    }

    if (userActiveAssignment) {
      if (userActiveAssignment.machineId) {
        setMachineId(userActiveAssignment.machineId);
      }
      if (userActiveAssignment.attachmentId && !attachmentId) {
        setAttachmentId(userActiveAssignment.attachmentId);
      }
      if (userActiveAssignment.parcelId && !parcelId) {
        setParcelId(userActiveAssignment.parcelId);
      }
    }
  }, [userActiveAssignment, orderIdParam, parcelIdParam, machineIdParam, attachmentIdParam, workTypeIdParam, workerIdParam]);

  useEffect(() => {
    if (orderData?.workOrder) {
      const wo = orderData.workOrder;
      if (wo.parcelId && !parcelId) setParcelId(wo.parcelId);
      if (wo.machineId && !machineId) setMachineId(wo.machineId);
      if (wo.attachmentId && !attachmentId) setAttachmentId(wo.attachmentId);
      if (wo.workTypeId && !workTypeId) setWorkTypeId(wo.workTypeId);
      if (wo.workerId && !workerId) setWorkerId(wo.workerId);
      if (wo.plannedAreaHa && !areaDoneHa) setAreaDoneHa(wo.plannedAreaHa);
    }
  }, [orderData]);

  useEffect(() => {
    if (workerIdParam) {
      setWorkerId(workerIdParam);
    }
  }, [workerIdParam]);

  useEffect(() => {
    if (workTypeIdParam) {
      setWorkTypeId(workTypeIdParam);
    }
  }, [workTypeIdParam]);

  // Pronađi trenutno izabranu parcelu za kalkulaciju
  const selectedParcelObj = parcelsData?.parcels?.find((p: any) => p.id === parcelId);
  const selectedMachineObj = machinesData?.machines?.find((m: any) => m.id === machineId);
  const linkedAssignment = orderData?.workOrder?.machineAssignments?.[0] || userActiveAssignment;
  const baselineHours = linkedAssignment?.startHours ?? selectedMachineObj?.currentHours;
  const isEndHoursInvalid =
    endHours !== '' &&
    baselineHours !== undefined &&
    parseFloat(String(endHours)) < baselineHours;

  const parcelMaxHa = selectedParcelObj ? Math.round(selectedParcelObj.areaHa * 1.2 * 100) / 100 : 0;
  const currentNumericArea = Number(areaDoneHa) || 0;

  // Opcije za CustomSelect
  const parcelOptions: CustomSelectOption[] = useMemo(() => {
    return (parcelsData?.parcels || []).map((p: any) => ({
      value: p.id,
      label: `[${p.code}] ${p.name}`,
      subLabel: `${p.areaHa} ha${p.currentCrop ? ` • ${p.currentCrop}` : ''}`,
    }));
  }, [parcelsData?.parcels]);

  const workTypeOptions: CustomSelectOption[] = useMemo(() => {
    return (workTypesData?.workTypes || []).map((wt: any) => ({
      value: wt.id,
      label: wt.name,
      subLabel: wt.category || undefined,
    }));
  }, [workTypesData?.workTypes]);

  const machineOptions: CustomSelectOption[] = useMemo(() => {
    return (machinesData?.machines || [])
      .filter((m: any) => {
        if (
          m.id === machineId ||
          m.id === userActiveAssignment?.machineId ||
          m.id === orderData?.workOrder?.machineId
        ) {
          return true;
        }
        if (m.type === 'PRIKLJUCAK') return false;
        if (m.isActive === false) return false;
        return m.status === 'SLOBODNA';
      })
      .map((m: any) => ({
        value: m.id,
        label: m.name,
        subLabel: [m.type, m.brandModel].filter(Boolean).join(' • ') || undefined,
      }));
  }, [machinesData?.machines, machineId, userActiveAssignment?.machineId, orderData?.workOrder?.machineId]);

  const attachmentOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = (machinesData?.machines || [])
      .filter((m: any) => {
        if (m.id === attachmentId || m.id === orderData?.workOrder?.attachmentId) {
          return true;
        }
        if (m.type !== 'PRIKLJUCAK') return false;
        if (m.isActive === false) return false;
        return m.status === 'SLOBODNA';
      })
      .map((m: any) => ({
        value: m.id,
        label: m.name,
        subLabel: m.brandModel || 'Priključno oruđe',
      }));
    return [
      { value: '', label: '— Bez priključka / Solo mašina —', subLabel: 'Rad mašine bez oruđa' },
      ...list,
    ];
  }, [machinesData?.machines, attachmentId, orderData?.workOrder?.attachmentId]);

  const workerOptions: CustomSelectOption[] = useMemo(() => {
    return (workersData?.workers || []).map((w: any) => ({
      value: w.id,
      label: w.name,
      subLabel: w.type || w.role || undefined,
    }));
  }, [workersData?.workers]);

  // Računanje radnih sati u realnom vremenu
  const calculateHoursLive = () => {
    if (!startTime || !endTime) return null;
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return null;

    let startTotal = startH * 60 + startM;
    let endTotal = endH * 60 + endM;
    if (endTotal < startTotal) endTotal += 24 * 60;

    return Math.round(((endTotal - startTotal) / 60) * 10) / 10;
  };

  const liveHours = calculateHoursLive();

  // Brzi tasteri za dodavanje hektara
  const handleAddArea = (delta: number) => {
    const current = Number(areaDoneHa) || 0;
    const nextVal = Math.round((current + delta) * 10) / 10;
    setAreaDoneHa(nextVal);
  };

  const handleSetFullParcelArea = () => {
    if (selectedParcelObj) {
      setAreaDoneHa(selectedParcelObj.areaHa);
    }
  };

  // MUTACIJA ZA SLANJE RADA NA NJIVI
  const submitMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(`${API}/field-work`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri čuvanju rada.');
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['field-works'] });
      queryClient.invalidateQueries({ queryKey: ['field-work-stats'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-active'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-stats'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-history'] });
      queryClient.invalidateQueries({ queryKey: ['machines-all'] });
      setSubmittedData(data.work);
      setErrorMsg('');
    },
    onError: (err: any) => {
      setErrorMsg(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!parcelId || !machineId || (!isOperator && !workerId) || !workTypeId) {
      setErrorMsg('Molimo popunite sva obavezna polja.');
      return;
    }

    if (!currentNumericArea || currentNumericArea <= 0) {
      setErrorMsg('Urađena površina mora biti veća od 0 ha.');
      return;
    }

    if (selectedParcelObj && currentNumericArea > parcelMaxHa) {
      setErrorMsg(
        `Uneti hektari (${currentNumericArea} ha) prelaze maksimalnih ${parcelMaxHa} ha za parcelu "${selectedParcelObj.name}".`
      );
      return;
    }

    if (isEndHoursInvalid) {
      setErrorMsg(`Krajnji radni sati (${endHours} rh) ne mogu biti manji od početnih (${baselineHours} rh).`);
      return;
    }

    const payload: any = {
      shift,
      parcelId,
      machineId,
      attachmentId: attachmentId || null,
      workTypeId,
      areaDoneHa: currentNumericArea,
      startTime: startTime || null,
      endTime: endTime || null,
      notes: notes || null,
      autoAssignMachine: true,
      workOrderId: orderIdParam || null,
      isOperational,
    };

    if (endFuelLiters !== '') {
      payload.endFuelLiters = parseFloat(String(endFuelLiters));
    }
    if (endHours !== '') {
      payload.endHours = parseFloat(String(endHours));
    }
    if (!isOperational && returnNotes) {
      payload.returnNotes = returnNotes;
    }

    if (!isOperator && workerId) {
      payload.workerId = workerId;
    }

    submitMutation.mutate(payload);
  };

  const handleResetForNext = () => {
    setSubmittedData(null);
    setAreaDoneHa('');
    setAttachmentId('');
    setEndHours('');
    setEndFuelLiters('');
    setNotes('');
    setErrorMsg('');
  };

  const isLoadingMaster = loadingParcels || loadingMachines || loadingWorkers || loadingWorkTypes;

  return (
    <AppLayout pageTitle="Brzi Unos Rada">
      <div className={styles.mobileContainer}>
        {/* Navigacija nazad */}
        <div className={styles.topNav}>
          <Link to="/radovi" className={styles.backBtn}>
            <ArrowLeft size={16} />
            <span>Nazad na Dnevnik</span>
          </Link>
        </div>

        {/* PRIKAZ NAKON USPEŠNOG UNOSA */}
        {submittedData ? (
          <div className={styles.successCard}>
            <div className={styles.successIcon}>
              <CheckCircle2 size={44} />
            </div>
            <h2 className={styles.successTitle}>Rad Uspešno Zabeležen!</h2>

            <div className={styles.successDetails}>
              <div>
                <strong>Parcela:</strong> {submittedData.parcel?.name} ({submittedData.areaDoneHa} ha)
              </div>
              <div>
                <strong>Radnik:</strong> {submittedData.worker?.name}
              </div>
              <div>
                <strong>Traktor:</strong> {submittedData.machine?.name}
              </div>
              {submittedData.attachment && (
                <div>
                  <strong>Priključak:</strong> {submittedData.attachment.name}
                </div>
              )}
              <div>
                <strong>Operacija:</strong> {submittedData.workType?.name}
              </div>
              <div>
                <strong>Radni sati:</strong> {submittedData.workHours ? `${submittedData.workHours} h` : '-'}
              </div>
            </div>

            <div className={styles.successActions}>
              {/* Prikazuj dugme za ručno razduživanje SAMO ako rad NIJE bio po nalogu i mašina NIJE već razdužena */}
              {!orderIdParam &&
                !submittedData.workOrderId &&
                !submittedData.isMachineUnassigned &&
                submittedData.machineId && (
                  <button
                    onClick={() =>
                      navigate(
                        `/zaduzivanje-masina?checkin=true&machineId=${submittedData.machineId}`
                      )
                    }
                    className={styles.btnFinishDay}
                  >
                    <KeyRound size={18} />
                    <span>
                      Razduži {submittedData.machine?.name ? submittedData.machine.name : 'Mašinu'} i završi dan
                    </span>
                  </button>
                )}

              {/* Ako je rad bio po radnom nalogu, direktno ponudi taster ka radnim nalozima */}
              {(orderIdParam || submittedData.workOrderId) && (
                <button
                  onClick={() => navigate('/nalozi')}
                  className={styles.submitBtn}
                  style={{ minWidth: 190, backgroundColor: '#0284c7' }}
                >
                  <ClipboardList size={18} />
                  <span>Pregledaj Radne Naloge</span>
                </button>
              )}

              <button
                onClick={handleResetForNext}
                className={styles.submitBtn}
                style={{ minWidth: 190, backgroundColor: '#16a34a' }}
              >
                <Plus size={18} />
                <span>Unesi Još Jedan Rad</span>
              </button>

              <button
                onClick={() => navigate('/radovi')}
                className={styles.backBtn}
                style={{ padding: '0.85rem 1.25rem', fontSize: '0.95rem' }}
              >
                Pregledaj Dnevnik Radova
              </button>
            </div>
          </div>
        ) : (
          /* GLAVNA FORMA ZA UNOS */
          <div className={styles.formCard}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>
                <Tractor size={24} color="#16a34a" />
                Unos Rada sa Njive
              </h2>
              <div className={styles.cardSubtitle}>
                Prilagođeno za brz unos direktno iz kabine traktora ili sa njive
              </div>
            </div>

            {orderIdParam && (
              <div
                style={{
                  background: 'rgba(2, 132, 199, 0.08)',
                  border: '1.5px solid #0284c7',
                  borderRadius: '12px',
                  padding: '0.85rem 1rem',
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  color: '#0369a1',
                }}
              >
                <ClipboardList size={22} color="#0284c7" />
                <div style={{ fontSize: '0.88rem' }}>
                  <strong>Popunjavanje rada po izdatom Radnom Nalogu</strong>
                  {orderData?.workOrder && (
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      Nalog: <strong>{orderData.workOrder.orderNumber}</strong>
                      {orderData.workOrder.machineAssignments?.[0]?.startFuelLiters !== undefined && (
                        <> — Zaduženo gorivo: <strong>{orderData.workOrder.machineAssignments[0].startFuelLiters} L</strong></>
                      )}
                    </span>
                  )}
                </div>
              </div>
            )}

            {errorMsg && (
              <div
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid #f87171',
                  color: '#dc2626',
                  padding: '0.85rem 1rem',
                  borderRadius: 12,
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <AlertCircle size={18} />
                <span>{errorMsg}</span>
              </div>
            )}

            {isLoadingMaster ? (
              <div style={{ textAlign: 'center', padding: '2.5rem' }}>
                <Loader2 size={32} className="spin" />
                <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>Učitavanje podataka firme...</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* PAMETNO PREPOZNAVANJE ZADUŽENJA (REŠENJE A) */}
                {userActiveAssignment ? (
                  <div className={styles.smartAssignmentBanner}>
                    <div className={styles.smartBannerIcon}>
                      <Tractor size={20} color="#16a34a" />
                    </div>
                    <div className={styles.smartBannerContent}>
                      <div className={styles.smartBannerTitle}>
                        Jutarnje zaduženje prepoznato: <strong>{userActiveAssignment.machine?.name}</strong>
                      </div>
                      <div className={styles.smartBannerDesc}>
                        Vaš zaduženi traktor je automatski povezan sa ovim unosom rada.
                      </div>
                    </div>
                    <span className={styles.smartBannerBadge}>Automatski povezano</span>
                  </div>
                ) : (
                  <div className={styles.smartAssignmentEmpty}>
                    <Info size={16} color="#2563eb" style={{ flexShrink: 0 }} />
                    <span>
                      Nema otvorenog jutarnjeg zaduženja — izaberite traktor ispod i sistem će ga{' '}
                      <strong>automatski povezati</strong> sa ovim radom.
                    </span>
                  </div>
                )}

                {/* 1. SMENA SELEKTOR */}
                <div className={styles.shiftSegmentContainer}>
                  <label className={styles.segmentLabel}>Radna Smena</label>
                  <div className={styles.shiftSegments}>
                    <button
                      type="button"
                      className={`${styles.shiftBtn} ${shift === 'PRVA' ? styles.shiftBtnActive : ''}`}
                      onClick={() => setShift('PRVA')}
                    >
                      <Sun size={15} />
                      <span>1. Smena</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.shiftBtn} ${shift === 'DRUGA' ? styles.shiftBtnActive : ''}`}
                      onClick={() => setShift('DRUGA')}
                    >
                      <SunMedium size={15} />
                      <span>2. Smena</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.shiftBtn} ${shift === 'TRECA' ? styles.shiftBtnActive : ''}`}
                      onClick={() => setShift('TRECA')}
                    >
                      <Moon size={15} />
                      <span>Noćna</span>
                    </button>
                  </div>
                </div>

                {/* 2. PARCELA */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <span>Parcela</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {selectedParcelObj && (
                        <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 800 }}>
                          Površina: {selectedParcelObj.areaHa} ha
                        </span>
                      )}
                      {isManager && (
                        <ParcelQuickActions
                          selectedParcel={selectedParcelObj || null}
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
                    </span>
                  </label>
                  <CustomSelect
                    value={parcelId}
                    onChange={(val) => setParcelId(val)}
                    options={parcelOptions}
                    placeholder="— Izaberite parcelu —"
                    searchable
                  />
                </div>

                {/* 3. URAĐENA POVRŠINA (HA) SA BRZIM TASTERIMA */}
                <div className={styles.areaSection}>
                  <label className={styles.fieldLabel}>Urađeno Hektara (ha)</label>

                  <div className={styles.areaInputRow}>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      placeholder="0.0"
                      className={styles.areaNumberInput}
                      value={areaDoneHa}
                      onChange={(e) => setAreaDoneHa(e.target.value)}
                      required
                    />
                    <div className={styles.areaUnitBadge}>ha</div>
                  </div>

                  {/* Brzi tasteri za dodavanje */}
                  <div className={styles.quickAddRow}>
                    <button type="button" className={styles.quickAddBtn} onClick={() => handleAddArea(0.5)}>
                      +0.5
                    </button>
                    <button type="button" className={styles.quickAddBtn} onClick={() => handleAddArea(1.0)}>
                      +1.0
                    </button>
                    <button type="button" className={styles.quickAddBtn} onClick={() => handleAddArea(2.0)}>
                      +2.0
                    </button>
                    <button type="button" className={styles.quickAddBtn} onClick={() => handleAddArea(5.0)}>
                      +5.0
                    </button>
                    <button
                      type="button"
                      className={`${styles.quickAddBtn} ${styles.quickAddFull}`}
                      onClick={handleSetFullParcelArea}
                      title="Postavi na punu površinu parcele"
                    >
                      Celo Polje
                    </button>
                  </div>

                  {/* Plausibility Status Boks */}
                  {selectedParcelObj && currentNumericArea > 0 && (
                    <div
                      className={`${styles.plausibilityBox} ${currentNumericArea <= selectedParcelObj.areaHa
                        ? styles.plausibilityValid
                        : currentNumericArea <= parcelMaxHa
                          ? styles.plausibilityWarning
                          : styles.plausibilityError
                        }`}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Info size={14} />
                        <span>
                          {currentNumericArea <= selectedParcelObj.areaHa
                            ? `U okviru parcele (${currentNumericArea} od ${selectedParcelObj.areaHa} ha)`
                            : currentNumericArea <= parcelMaxHa
                              ? `Prekoračenje unutar tolerancije (+20% dozvoljeno: max ${parcelMaxHa} ha)`
                              : `PREKORAČENJE! Maksimalno dozvoljeno je ${parcelMaxHa} ha!`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. RADNA OPERACIJA */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Radna Operacija</label>
                  <CustomSelect
                    value={workTypeId}
                    onChange={(val) => setWorkTypeId(val)}
                    options={workTypeOptions}
                    placeholder="— Izaberite radnu operaciju —"
                    searchable
                  />
                </div>

                {/* 5. MAŠINA I RADNIK */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    <span>Traktor / Mašina</span>
                    {userActiveAssignment && userActiveAssignment.machineId === machineId ? (
                      <span style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <CheckCircle2 size={13} />
                        <span>Preuzeto sa jutarnjeg zaduženja</span>
                      </span>
                    ) : selectedMachineObj ? (
                      <span style={{ fontSize: '0.75rem', color: '#0284c7', fontWeight: 700 }}>
                        Stanje: {selectedMachineObj.currentHours ?? 0} rh • {selectedMachineObj.currentFuelLiters !== null && selectedMachineObj.currentFuelLiters !== undefined ? `${selectedMachineObj.currentFuelLiters} L` : '0 L'}
                      </span>
                    ) : null}
                  </label>
                  <CustomSelect
                    value={machineId}
                    onChange={(val) => setMachineId(val)}
                    options={machineOptions}
                    placeholder="— Izaberite traktor / mašinu —"
                    searchable
                  />
                </div>

                {/* 5.1 PRIKLJUČNA MAŠINA / ORUĐE */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    <span>Priključak / Oruđe (opciono)</span>
                    {orderData?.workOrder?.attachmentId && orderData?.workOrder?.attachmentId === attachmentId && (
                      <span style={{ fontSize: '0.72rem', color: '#0284c7', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <CheckCircle2 size={13} />
                        <span>Preuzeto sa radnog naloga</span>
                      </span>
                    )}
                  </label>
                  <CustomSelect
                    value={attachmentId}
                    onChange={(val) => setAttachmentId(val)}
                    options={attachmentOptions}
                    placeholder="— Bez priključka / Solo mašina —"
                    searchable
                  />
                </div>

                {!isOperator ? (
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Radnik (Traktorista / Sezonac)</label>
                    <CustomSelect
                      value={workerId}
                      onChange={(val) => setWorkerId(val)}
                      options={workerOptions}
                      placeholder="— Izaberite radnika —"
                      searchable
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.85rem',
                      color: 'var(--text-secondary)',
                      backgroundColor: 'var(--bg-secondary)',
                      padding: '0.75rem 1rem',
                      borderRadius: 12,
                      border: '1.5px solid var(--border-color)',
                    }}
                  >
                    <User size={16} color="#16a34a" />
                    <span>
                      Radnik: <strong>{currentUser?.name || 'Operater'}</strong>
                    </span>
                  </div>
                )}

                {/* 6. VREME RADA I AUTOMATSKI RADNI SATI */}
                <div className={styles.timeRow}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Početak rada</label>
                    <input
                      type="time"
                      className={styles.fieldInput}
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Kraj rada</label>
                    <input
                      type="time"
                      className={styles.fieldInput}
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                    />
                  </div>
                </div>

                {liveHours !== null && (
                  <div className={styles.hoursCalculatedBox}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Clock size={16} />
                      <span>Radno vreme:</span>
                    </div>
                    <span style={{ fontSize: '1rem', fontWeight: 800 }}>{liveHours}h</span>
                  </div>
                )}

                {/* 7. RAZDUŽENJE MAŠINE & STANJE GORIVA */}
                <div
                  style={{
                    background: 'var(--card-bg)',
                    border: '1.5px solid var(--border-color)',
                    borderRadius: '12px',
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.85rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      fontSize: '0.95rem',
                    }}
                  >
                    <Fuel size={18} color="#0284c7" />
                    <span>Razduženje Mašine & Stanje Goriva</span>
                  </div>

                  {(() => {
                    const linkedAssignment =
                      orderData?.workOrder?.machineAssignments?.[0] || userActiveAssignment;
                    const baselineFuel =
                      linkedAssignment?.startFuelLiters ?? selectedMachineObj?.currentFuelLiters;
                    const baselineStartHours =
                      linkedAssignment?.startHours ?? selectedMachineObj?.currentHours;

                    const startFuelNum = Number(baselineFuel) || 0;
                    const endFuelNum = Number(endFuelLiters) || 0;
                    const fuelSpent =
                      startFuelNum > 0 && endFuelNum > 0 && startFuelNum >= endFuelNum
                        ? Math.round((startFuelNum - endFuelNum) * 10) / 10
                        : null;
                    const spentPerHa =
                      fuelSpent !== null && currentNumericArea > 0
                        ? Math.round((fuelSpent / currentNumericArea) * 10) / 10
                        : null;
                    const selectedWorkTypeObj = workTypesData?.workTypes?.find(
                      (wt: any) => wt.id === workTypeId
                    );

                    return (
                      <>
                        {linkedAssignment ? (
                          <div className={styles.machineStatusCardBlue}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}>
                              <CheckCircle2 size={15} />
                              <span>Preuzeto sa zaduženja:</span>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', fontWeight: 700 }}>
                              <span>
                                Gorivo: <strong>{linkedAssignment.startFuelLiters !== null && linkedAssignment.startFuelLiters !== undefined ? `${linkedAssignment.startFuelLiters} L` : '—'}</strong>
                              </span>
                              <span>
                                Početni rh: <strong>{linkedAssignment.startHours ?? 0} rh</strong>
                              </span>
                            </div>
                          </div>
                        ) : selectedMachineObj ? (
                          <div className={styles.machineStatusCardTeal}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700 }}>
                              <Gauge size={16} />
                              <span>Trenutno stanje u mašini:</span>
                            </div>
                            <div style={{ display: 'flex', gap: '1.2rem', fontWeight: 700 }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <Fuel size={14} />
                                <span>
                                  Gorivo:{' '}
                                  <strong style={{ fontSize: '0.92rem' }}>
                                    {selectedMachineObj.currentFuelLiters !== null && selectedMachineObj.currentFuelLiters !== undefined
                                      ? `${selectedMachineObj.currentFuelLiters} L`
                                      : '0 L'}
                                  </strong>
                                  {selectedMachineObj.tankCapacityLiters ? (
                                    <span style={{ fontSize: '0.78rem', opacity: 0.85, fontWeight: 600 }}>
                                      {' '}/ {selectedMachineObj.tankCapacityLiters} L
                                    </span>
                                  ) : null}
                                </span>
                              </span>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <Clock size={14} />
                                <span>
                                  Radni sati:{' '}
                                  <strong style={{ fontSize: '0.92rem' }}>
                                    {selectedMachineObj.currentHours ?? 0} rh
                                  </strong>
                                </span>
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className={styles.machineStatusCardPlaceholder}>
                            <Info size={15} />
                            <span>Izaberite traktor / mašinu iznad da biste videli trenutno stanje goriva i radnih sati.</span>
                          </div>
                        )}

                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>
                            <span>Krajnje stanje goriva nakon rada (litara)</span>
                            {fuelSpent !== null && (
                              <span style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 700 }}>
                                Utrošeno: {fuelSpent} L {spentPerHa ? `(${spentPerHa} L/ha)` : ''}
                              </span>
                            )}
                          </label>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            placeholder={baselineFuel !== undefined && baselineFuel !== null ? `Trenutno: ${baselineFuel} L` : "npr. 135"}
                            className={styles.fieldInput}
                            value={endFuelLiters}
                            onChange={(e) => setEndFuelLiters(e.target.value)}
                          />
                          {selectedWorkTypeObj?.fuelNormLitersPerHa && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              Planirani normativ posla: {selectedWorkTypeObj.fuelNormLitersPerHa} L/ha
                            </div>
                          )}
                        </div>

                        <div className={styles.fieldGroup}>
                          <label className={styles.fieldLabel}>Krajnji radni sati mašine (rh)</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            placeholder={baselineStartHours !== undefined && baselineStartHours !== null ? `Početno: ${baselineStartHours} rh` : "npr. 1428.5"}
                            className={`${styles.fieldInput} ${isEndHoursInvalid ? styles.fieldInputError : ''}`}
                            value={endHours}
                            onChange={(e) => setEndHours(e.target.value)}
                          />
                          {isEndHoursInvalid && (
                            <div className={styles.fieldErrorText}>
                              <AlertTriangle size={15} />
                              <span>
                                Krajnji radni sati ({endHours} rh) ne mogu biti manji od početnih ({baselineHours} rh)!
                              </span>
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.2rem' }}>
                          <input
                            type="checkbox"
                            id="operationalCheck"
                            checked={isOperational}
                            onChange={(e) => setIsOperational(e.target.checked)}
                            style={{ width: 18, height: 18, accentColor: '#16a34a', cursor: 'pointer' }}
                          />
                          <label
                            htmlFor="operationalCheck"
                            style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}
                          >
                            Mašina je vraćena potpuno ispravna
                          </label>
                        </div>

                        {!isOperational && (
                          <div className={styles.fieldGroup} style={{ marginTop: '0.35rem' }}>
                            <label className={styles.fieldLabel} style={{ color: '#dc2626' }}>
                              Opis uočenog problema / kvara
                            </label>
                            <textarea
                              rows={2}
                              className={styles.fieldInput}
                              placeholder="npr. Puklo crevo hidraulike, curi ulje..."
                              value={returnNotes}
                              onChange={(e) => setReturnNotes(e.target.value)}
                              style={{ borderColor: '#fca5a5' }}
                            />
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* 8. NAPOMENA */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Napomena sa terena (opciono)</label>
                  <textarea
                    rows={2}
                    className={styles.fieldInput}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Npr. dubina oranja 30cm, suvo tlo, zamenjen nož..."
                    style={{ resize: 'vertical' }}
                  />
                </div>

                {/* TASTER ZA SLANJE */}
                <button
                  type="submit"
                  className={styles.submitBtn}
                  disabled={submitMutation.isPending || isEndHoursInvalid || (selectedParcelObj && currentNumericArea > parcelMaxHa)}
                >
                  {submitMutation.isPending ? (
                    <>
                      <Loader2 size={20} className="spin" />
                      <span>Slanje podataka...</span>
                    </>
                  ) : (
                    <>
                      <Send size={20} />
                      <span>
                        {orderIdParam
                          ? 'Zabeleži Rad i Razduži Mašinu'
                          : 'Zabeleži Rad na Njivi'}
                      </span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Brzi modal za dodavanje / izmenu parcele */}
        <ParcelQuickModal
          isOpen={parcelQuickModalOpen}
          onClose={() => setParcelQuickModalOpen(false)}
          parcelToEdit={parcelToEdit}
          onSaved={(savedParcel) => {
            setParcelId(savedParcel.id);
          }}
        />
      </div>
    </AppLayout>
  );
};

export default BrziUnosRada;
