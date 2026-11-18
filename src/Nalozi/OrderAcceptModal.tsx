import React, { useState } from 'react';
import { KeyRound, X, AlertCircle, Tractor, Info, Loader2 } from 'lucide-react';
import type { WorkOrder } from './RadniNaloziDashboard';
import styles from './RadniNaloziDashboard.module.css';

interface OrderAcceptModalProps {
  order: WorkOrder;
  onClose: () => void;
  onAccepted: () => void;
}

const OrderAcceptModal: React.FC<OrderAcceptModalProps> = ({ order, onClose, onAccepted }) => {
  const [fuelLiters, setFuelLiters] = useState<string | number>(order.machine?.currentFuelLiters ?? '');
  const [hours, setHours] = useState<string | number>(order.machine?.currentHours || 0);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const maxTank = order.machine?.tankCapacityLiters;
    const fuelNum = parseFloat(String(fuelLiters));
    if (maxTank && fuelNum > maxTank) {
      setError(`Količina goriva (${fuelNum} L) ne može biti veća od kapaciteta rezervoara mašine (${maxTank} L).`);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/work-orders/${order.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startFuelLiters: parseFloat(String(fuelLiters)) || 0,
          expectedMachineUpdatedAt: order.machine?.updatedAt,
          startHours: hours !== '' ? parseFloat(String(hours)) : null,
          notes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri prihvatanju radnog naloga.');
      }

      onAccepted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Greška pri prihvatanju radnog naloga.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>
            <KeyRound size={22} color="#0284c7" />
            Prihvati Nalog & Zaduži Mašinu
          </h3>
          <button type="button" className={styles.modalCloseBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: '0.75rem 1.25rem',
              background: '#fee2e2',
              color: '#b91c1c',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          {order.machine && (
            <div className={styles.machineSummaryCard}>
              <div className={styles.machineSummaryTitle}>
                <Tractor size={18} color="#16a34a" />
                <span>{order.machine.name}</span>
              </div>
              <div className={styles.machineSpecsRow}>
                <span className={styles.machineSpecItem}>
                  Rezervoar:{' '}
                  <strong>
                    {order.machine.tankCapacityLiters && order.machine.tankCapacityLiters > 0
                      ? `${order.machine.tankCapacityLiters} L`
                      : 'Bez rezervoara (Priključak)'}
                  </strong>
                </span>
                <span className={styles.machineSpecItem}>
                  Radni sati na satu:{' '}
                  <strong>{order.machine.currentHours || 0} rh</strong>
                </span>
              </div>
            </div>
          )}

          {order.machine?.tankCapacityLiters && order.machine.tankCapacityLiters > 0 ? (
            <div className={styles.formGroup}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label style={{ margin: 0 }}>Početno stanje goriva u rezervoaru (litara) *</label>
                <span style={{ color: '#0284c7', fontWeight: 700, fontSize: '0.85rem' }}>
                  Kapacitet: {order.machine?.tankCapacityLiters} L
                </span>
              </div>
              <div className={styles.fuelInputWrap}>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max={order.machine?.tankCapacityLiters || 1000}
                  className={styles.modalInput}
                  placeholder={`npr. ${Math.min(180, order.machine?.tankCapacityLiters || 200)}`}
                  value={fuelLiters}
                  onChange={(e) => {
                    const val = e.target.value;
                    const maxCap = order.machine?.tankCapacityLiters;
                    if (maxCap && val !== '' && Number(val) > maxCap) {
                      setFuelLiters(maxCap);
                      return;
                    }
                    setFuelLiters(val);
                  }}
                  style={
                    order.machine?.tankCapacityLiters && Number(fuelLiters) > order.machine.tankCapacityLiters
                      ? { borderColor: '#ef4444' }
                      : undefined
                  }
                  required
                />
                <span className={styles.fuelUnitBadge}>Litara</span>
              </div>
              {order.machine?.tankCapacityLiters && Number(fuelLiters) > order.machine.tankCapacityLiters && (
                <div style={{ color: '#ef4444', fontSize: '0.82rem', marginTop: '0.3rem', fontWeight: 600 }}>
                  Količina goriva ne može biti veća od kapaciteta rezervoara ({order.machine.tankCapacityLiters} L)!
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                background: 'rgba(2, 132, 199, 0.08)',
                border: '1.5px dashed #38bdf8',
                borderRadius: 10,
                padding: '0.85rem 1rem',
                fontSize: '0.86rem',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.55rem',
                margin: '0.25rem 0',
              }}
            >
              <Info size={18} color="#0284c7" style={{ flexShrink: 0 }} />
              <span>
                Ova mašina nema sopstveni rezervoar goriva (priključno oruđe). Gorivo se ne zadužuje.
              </span>
            </div>
          )}

          <div className={styles.formGroup}>
            <label>Početni radni sati mašine (rh)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              className={styles.modalInput}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Napomena pri preuzimanju mašine (opciono)</label>
            <textarea
              className={styles.modalTextarea}
              placeholder="npr. Provereni nivoi ulja i antifriza, traktor spreman za oranje."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.cancelModalBtn} onClick={onClose}>
              Odustani
            </button>
            <button
              type="submit"
              className={styles.saveBtn}
              style={{ backgroundColor: '#0284c7' }}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 size={16} />
                  <span>Zaduživanje...</span>
                </>
              ) : (
                <>
                  <KeyRound size={16} />
                  <span>Zaduži mašinu i prihvati nalog</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OrderAcceptModal;
