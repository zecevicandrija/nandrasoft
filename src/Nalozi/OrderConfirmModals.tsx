import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, AlertCircle, Info, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import type { WorkOrder } from './RadniNaloziDashboard';
import styles from './RadniNaloziDashboard.module.css';

const shortDateFormatter = new Intl.DateTimeFormat('sr-RS');

interface OrderConfirmModalsProps {
  orderToCancel: WorkOrder | null;
  orderToReactivate: WorkOrder | null;
  orderToDelete: WorkOrder | null;
  onCloseCancel: () => void;
  onCloseReactivate: () => void;
  onCloseDelete: () => void;
  onMutated: (action: 'cancel' | 'reactivate' | 'delete') => void;
}

const OrderConfirmModals: React.FC<OrderConfirmModalsProps> = ({
  orderToCancel,
  orderToReactivate,
  orderToDelete,
  onCloseCancel,
  onCloseReactivate,
  onCloseDelete,
  onMutated,
}) => {
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [reactivateLoading, setReactivateLoading] = useState(false);
  const [reactivateError, setReactivateError] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleConfirmCancel = async () => {
    if (!orderToCancel) return;
    setCancelLoading(true);
    setCancelError('');
    try {
      const res = await fetch(`/api/work-orders/${orderToCancel.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'OTKAZAN' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri otkazivanju radnog naloga.');
      }
      onCloseCancel();
      onMutated('cancel');
    } catch (err: unknown) {
      setCancelError(err instanceof Error ? err.message : 'Greška pri otkazivanju radnog naloga.');
    } finally {
      setCancelLoading(false);
    }
  };

  const handleConfirmReactivate = async () => {
    if (!orderToReactivate) return;
    setReactivateLoading(true);
    setReactivateError('');
    try {
      const targetStatus = orderToReactivate.workerId ? 'DODELJEN' : 'PLANIRAN';
      const res = await fetch(`/api/work-orders/${orderToReactivate.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: targetStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri ponovnom aktiviranju radnog naloga.');
      }
      onCloseReactivate();
      onMutated('reactivate');
    } catch (err: unknown) {
      setReactivateError(err instanceof Error ? err.message : 'Greška pri ponovnom aktiviranju radnog naloga.');
    } finally {
      setReactivateLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!orderToDelete) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/work-orders/${orderToDelete.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri brisanju radnog naloga.');
      }
      onCloseDelete();
      onMutated('delete');
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Greška pri brisanju radnog naloga.');
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <>
      {orderToCancel && (
        <div className={styles.modalBackdrop} onClick={() => { if (!cancelLoading) { setCancelError(''); onCloseCancel(); } }}>
          <div className={styles.modalContent} style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 style={{ color: '#b91c1c' }}>
                <AlertTriangle size={22} color="#dc2626" />
                <span>Otkazivanje Radnog Naloga</span>
              </h3>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => { if (!cancelLoading) { setCancelError(''); onCloseCancel(); } }}
                disabled={cancelLoading}
              >
                <X size={20} />
              </button>
            </div>

            <div className={styles.confirmDialogBody}>
              <div className={styles.confirmWarningBox}>
                <AlertCircle size={22} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                    Da li stvarno želite da otkažete ovaj radni nalog?
                  </div>
                  <div style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
                    Radni nalog će biti prebačen u status <strong>Otkazan</strong>.
                    Ukoliko se predomislite, nalog možete u svakom trenutku ponovo aktivirati.
                  </div>
                </div>
              </div>

              {orderToCancel.status === 'U_TOKU' && orderToCancel.orderType === 'RAD_NJIVA' && (
                <Link
                  className={styles.saveBtn}
                  to={`/radovi/novi?orderId=${orderToCancel.id}&cancelRemainder=true`}
                  onClick={onCloseCancel}
                >
                  Evidentiraj rad i otkaži ostatak
                </Link>
              )}

              {orderToCancel.status === 'U_TOKU' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    background: '#fffbeb',
                    border: '1px solid #fef3c7',
                    borderLeft: '4px solid #f59e0b',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    color: '#92400e',
                    fontSize: '0.84rem',
                    lineHeight: 1.45,
                  }}
                >
                  <Info size={20} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong style={{ display: 'block', marginBottom: '0.2rem', color: '#b45309' }}>
                      Napomena: Radnik je već prihvatio ovaj nalog
                    </strong>
                    Otkazivanjem se mašina automatski oslobađa, a radni sati ostaju nepromenjeni. Ako je radnik već radio na parceli, preporučuje se da radnik sam prijavi prekid rada kako bi se evidentirali urađeni sati i gorivo.
                  </div>
                </div>
              )}

              {cancelError && (
                <div style={{ padding: '0.75rem 1rem', background: '#fee2e2', color: '#b91c1c', borderRadius: '6px', fontSize: '0.85rem' }}>
                  {cancelError}
                </div>
              )}

              <div className={styles.orderPreviewBox}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '0.4rem', fontWeight: 700 }}>
                  <span>Broj naloga:</span>
                  <span style={{ color: '#16a34a' }}>{orderToCancel.orderNumber}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Trenutni status:</span>
                  <span style={{ fontWeight: 600 }}>
                    {orderToCancel.status === 'U_TOKU'
                      ? 'U toku (Mašina zadužena)'
                      : orderToCancel.status === 'DODELJEN'
                        ? 'Dodeljen'
                        : orderToCancel.status}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Radnik:</span>
                  <span style={{ fontWeight: 600 }}>{orderToCancel.worker?.name || 'Nije dodeljen'}</span>
                </div>
                {orderToCancel.parcel && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Parcela:</span>
                    <span>{orderToCancel.parcel.name}</span>
                  </div>
                )}
                {orderToCancel.workType && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Operacija:</span>
                    <span>{orderToCancel.workType.name}</span>
                  </div>
                )}
                {orderToCancel.machine && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Mašina:</span>
                    <span>{orderToCancel.machine.name}</span>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.cancelModalBtn}
                onClick={() => { setCancelError(''); onCloseCancel(); }}
                disabled={cancelLoading}
              >
                Odustani
              </button>
              <button
                type="button"
                className={styles.confirmCancelBtn}
                onClick={handleConfirmCancel}
                disabled={cancelLoading}
              >
                {cancelLoading ? (
                  <>
                    <Loader2 size={16} className={styles.spinnerIcon} />
                    <span>Otkazivanje...</span>
                  </>
                ) : (
                  <span>Da, otkaži nalog</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {orderToReactivate && (
        <div className={styles.modalBackdrop} onClick={() => { if (!reactivateLoading) { setReactivateError(''); onCloseReactivate(); } }}>
          <div className={styles.modalContent} style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 style={{ color: '#15803d' }}>
                <RotateCcw size={20} color="#16a34a" />
                <span>Ponovno Aktiviranje Naloga</span>
              </h3>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => { if (!reactivateLoading) { setReactivateError(''); onCloseReactivate(); } }}
                disabled={reactivateLoading}
              >
                <X size={20} />
              </button>
            </div>

            <div className={styles.confirmDialogBody}>
              <div className={styles.confirmInfoBox}>
                <RotateCcw size={22} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                    Da li želite ponovo da aktivirate ovaj radni nalog?
                  </div>
                  <div style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
                    Radni nalog <strong>{orderToReactivate.orderNumber}</strong> će biti vraćen u status <strong>Dodeljen</strong> i ponovo će se pojaviti radniku na listi zadataka za izvršenje.
                  </div>
                </div>
              </div>

              {reactivateError && (
                <div style={{ padding: '0.75rem 1rem', background: '#fee2e2', color: '#b91c1c', borderRadius: '6px', fontSize: '0.85rem' }}>
                  {reactivateError}
                </div>
              )}

              <div className={styles.orderPreviewBox}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '0.4rem', fontWeight: 700 }}>
                  <span>Broj naloga:</span>
                  <span style={{ color: '#16a34a' }}>{orderToReactivate.orderNumber}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Radnik:</span>
                  <span style={{ fontWeight: 600 }}>{orderToReactivate.worker?.name || 'Nije dodeljen'}</span>
                </div>
                {orderToReactivate.parcel && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Parcela:</span>
                    <span>{orderToReactivate.parcel.name}</span>
                  </div>
                )}
                {orderToReactivate.workType && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Operacija:</span>
                    <span>{orderToReactivate.workType.name}</span>
                  </div>
                )}
                {orderToReactivate.machine && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Mašina:</span>
                    <span>{orderToReactivate.machine.name}</span>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.cancelModalBtn}
                onClick={() => { setReactivateError(''); onCloseReactivate(); }}
                disabled={reactivateLoading}
              >
                Odustani
              </button>
              <button
                type="button"
                className={styles.confirmReactivateBtn}
                onClick={handleConfirmReactivate}
                disabled={reactivateLoading}
              >
                {reactivateLoading ? (
                  <>
                    <Loader2 size={16} className={styles.spinnerIcon} />
                    <span>Aktiviranje...</span>
                  </>
                ) : (
                  <span>Ponovo aktiviraj nalog</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {orderToDelete && (
        <div className={styles.modalBackdrop} onClick={() => { if (!deleteLoading) { setDeleteError(''); onCloseDelete(); } }}>
          <div className={styles.modalContent} style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 style={{ color: '#b91c1c' }}>
                <AlertTriangle size={22} color="#dc2626" />
                <span>Trajno Brisanje Radnog Naloga</span>
              </h3>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => { if (!deleteLoading) { setDeleteError(''); onCloseDelete(); } }}
                disabled={deleteLoading}
              >
                <X size={20} />
              </button>
            </div>

            <div className={styles.confirmDialogBody}>
              <div className={styles.confirmWarningBox}>
                <AlertCircle size={22} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                    Da li ste sigurni da želite trajno da obrišete ovaj radni nalog?
                  </div>
                  <div style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
                    Ova akcija je <strong>nepovratna</strong>. Radni nalog <strong>{orderToDelete.orderNumber}</strong> će biti trajno obrisan iz sistema.
                  </div>
                </div>
              </div>

              {orderToDelete.status === 'ZAVRSEN' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    background: 'rgba(2, 132, 199, 0.08)',
                    border: '1px solid #bae6fd',
                    borderLeft: '4px solid #0284c7',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    color: '#0369a1',
                    fontSize: '0.84rem',
                    lineHeight: 1.45,
                  }}
                >
                  <Info size={20} color="#0284c7" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong style={{ display: 'block', marginBottom: '0.2rem' }}>
                      Završen radni nalog
                    </strong>
                    Uklanjanjem radnog naloga sama evidencija o izvršenom radu na njivi ostaje sačuvana u istorijatu i izveštajima.
                  </div>
                </div>
              )}

              {deleteError && (
                <div style={{ padding: '0.75rem 1rem', background: '#fee2e2', color: '#b91c1c', borderRadius: '6px', fontSize: '0.85rem' }}>
                  {deleteError}
                </div>
              )}

              <div className={styles.orderPreviewBox}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '0.4rem', fontWeight: 700 }}>
                  <span>Broj naloga:</span>
                  <span style={{ color: '#16a34a' }}>{orderToDelete.orderNumber}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Status:</span>
                  <span style={{ fontWeight: 600 }}>{orderToDelete.status}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Radnik:</span>
                  <span style={{ fontWeight: 600 }}>{orderToDelete.worker?.name || 'Nije dodeljen'}</span>
                </div>
                {orderToDelete.orderDate && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Datum naloga:</span>
                    <span>{shortDateFormatter.format(new Date(orderToDelete.orderDate))}</span>
                  </div>
                )}
                {orderToDelete.parcel && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Parcela:</span>
                    <span>{orderToDelete.parcel.name}</span>
                  </div>
                )}
                {orderToDelete.machine && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Mašina:</span>
                    <span>{orderToDelete.machine.name}</span>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.cancelModalBtn}
                onClick={() => { setDeleteError(''); onCloseDelete(); }}
                disabled={deleteLoading}
              >
                Odustani
              </button>
              <button
                type="button"
                className={styles.confirmCancelBtn}
                onClick={handleConfirmDelete}
                disabled={deleteLoading}
              >
                {deleteLoading ? (
                  <>
                    <Loader2 size={16} className={styles.spinnerIcon} />
                    <span>Brisanje...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    <span>Da, trajno obriši</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default OrderConfirmModals;
