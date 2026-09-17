import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import { useSession } from '../lib/auth-client';
import styles from './BrziUnosRada.module.css';

const API = 'http://localhost:5000/api';

const BrziUnosRada: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUser = (session as any)?.user;
  const isOperator = currentUser?.role === 'OPERATER';

  // Form states
  const [shift, setShift] = useState<'PRVA' | 'DRUGA' | 'TRECA'>('PRVA');
  const [parcelId, setParcelId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [workTypeId, setWorkTypeId] = useState('');
  const [areaDoneHa, setAreaDoneHa] = useState<number | string>('');
  const [startTime, setStartTime] = useState('07:00');
  const [endTime, setEndTime] = useState('15:30');
  const [notes, setNotes] = useState('');

  // UI state
  const [errorMsg, setErrorMsg] = useState('');
  const [submittedData, setSubmittedData] = useState<any | null>(null);

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

  // Postavi inicijalne vrednosti kada stignu podaci
  useEffect(() => {
    if (!parcelId && parcelsData?.parcels?.length > 0) {
      setParcelId(parcelsData.parcels[0].id);
    }
  }, [parcelsData, parcelId]);

  useEffect(() => {
    if (!machineId && machinesData?.machines?.length > 0) {
      setMachineId(machinesData.machines[0].id);
    }
  }, [machinesData, machineId]);

  useEffect(() => {
    if (!workerId && workersData?.workers?.length > 0) {
      setWorkerId(workersData.workers[0].id);
    }
  }, [workersData, workerId]);

  useEffect(() => {
    if (!workTypeId && workTypesData?.workTypes?.length > 0) {
      setWorkTypeId(workTypesData.workTypes[0].id);
    }
  }, [workTypesData, workTypeId]);

  // Pronađi trenutno izabranu parcelu za kalkulaciju
  const selectedParcelObj = parcelsData?.parcels?.find((p: any) => p.id === parcelId);
  const parcelMaxHa = selectedParcelObj ? Math.round(selectedParcelObj.areaHa * 1.2 * 100) / 100 : 0;
  const currentNumericArea = Number(areaDoneHa) || 0;

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

    const payload: any = {
      shift,
      parcelId,
      machineId,
      workTypeId,
      areaDoneHa: currentNumericArea,
      startTime: startTime || null,
      endTime: endTime || null,
      notes: notes || null,
    };

    if (!isOperator && workerId) {
      payload.workerId = workerId;
    }

    submitMutation.mutate(payload);
  };

  const handleResetForNext = () => {
    setSubmittedData(null);
    setAreaDoneHa('');
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
            <p className={styles.successDesc}>
              Posao je evidentiran u bazi i odmah je vidljiv na dashboardu i u dnevniku radova.
            </p>

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
              <div>
                <strong>Operacija:</strong> {submittedData.workType?.name}
              </div>
              <div>
                <strong>Radni sati:</strong> {submittedData.workHours ? `${submittedData.workHours} rh` : '-'}
              </div>
            </div>

            <div className={styles.successActions}>
              <button onClick={handleResetForNext} className={styles.submitBtn} style={{ minWidth: 200 }}>
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
                {/* 1. SMENA SELEKTOR */}
                <div className={styles.shiftSegmentContainer}>
                  <label className={styles.segmentLabel}>Radna Smena</label>
                  <div className={styles.shiftSegments}>
                    <button
                      type="button"
                      className={`${styles.shiftBtn} ${shift === 'PRVA' ? styles.shiftBtnActive : ''}`}
                      onClick={() => setShift('PRVA')}
                    >
                      <span>☀️ 1. Smena</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.shiftBtn} ${shift === 'DRUGA' ? styles.shiftBtnActive : ''}`}
                      onClick={() => setShift('DRUGA')}
                    >
                      <span>🌤️ 2. Smena</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.shiftBtn} ${shift === 'TRECA' ? styles.shiftBtnActive : ''}`}
                      onClick={() => setShift('TRECA')}
                    >
                      <span>🌙 Noćna</span>
                    </button>
                  </div>
                </div>

                {/* 2. PARCELA */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>
                    <span>Parcela</span>
                    {selectedParcelObj && (
                      <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 800 }}>
                        Površina: {selectedParcelObj.areaHa} ha
                      </span>
                    )}
                  </label>
                  <select
                    className={styles.fieldSelect}
                    value={parcelId}
                    onChange={(e) => setParcelId(e.target.value)}
                    required
                  >
                    {parcelsData?.parcels?.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        [{p.code}] {p.name} ({p.areaHa} ha)
                      </option>
                    ))}
                  </select>
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
                      className={`${styles.plausibilityBox} ${
                        currentNumericArea <= selectedParcelObj.areaHa
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
                  <select
                    className={styles.fieldSelect}
                    value={workTypeId}
                    onChange={(e) => setWorkTypeId(e.target.value)}
                    required
                  >
                    {workTypesData?.workTypes?.map((wt: any) => (
                      <option key={wt.id} value={wt.id}>
                        {wt.name} [{wt.category}]
                      </option>
                    ))}
                  </select>
                </div>

                {/* 5. MAŠINA I RADNIK */}
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>Traktor / Mašina</label>
                  <select
                    className={styles.fieldSelect}
                    value={machineId}
                    onChange={(e) => setMachineId(e.target.value)}
                    required
                  >
                    {machinesData?.machines?.map((m: any) => (
                      <option key={m.id} value={m.id}>
                        🚜 {m.name} ({m.type})
                      </option>
                    ))}
                  </select>
                </div>

                {!isOperator ? (
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Radnik (Traktorista / Sezonac)</label>
                    <select
                      className={styles.fieldSelect}
                      value={workerId}
                      onChange={(e) => setWorkerId(e.target.value)}
                      required
                    >
                      {workersData?.workers?.map((w: any) => (
                        <option key={w.id} value={w.id}>
                          👤 {w.name} [{w.type}]
                        </option>
                      ))}
                    </select>
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
                      Radnik: <strong>{currentUser?.name || 'Operater'}</strong> (automatski se beleži sa vašeg naloga)
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
                      <span>Automatski izračunato radno vreme:</span>
                    </div>
                    <span style={{ fontSize: '1rem', fontWeight: 800 }}>{liveHours} rh</span>
                  </div>
                )}

                {/* 7. NAPOMENA */}
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
                  disabled={submitMutation.isPending || (selectedParcelObj && currentNumericArea > parcelMaxHa)}
                >
                  {submitMutation.isPending ? (
                    <>
                      <Loader2 size={20} className="spin" />
                      <span>Slanje podataka...</span>
                    </>
                  ) : (
                    <>
                      <Send size={20} />
                      <span>Zabeleži Rad na Njivi</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default BrziUnosRada;
