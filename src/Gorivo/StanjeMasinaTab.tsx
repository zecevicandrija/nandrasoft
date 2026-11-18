import React, { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Truck,
  Fuel,
  Plus,
  Search,
  AlertTriangle,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import TablePagination from '../components/TablePagination/TablePagination';
import { MasinaModal, type MachineStateItem } from './MasinaModal';
import styles from './StanjeMasinaTab.module.css';

export interface MachineStatesSummary {
  totalMachines: number;
  totalFuel: number;
  activeWithTank: number;
  lowFuelCount: number;
}

export interface MachineStatesPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface StanjeMasinaTabProps {
  machines: MachineStateItem[];
  pagination?: MachineStatesPagination;
  summary?: MachineStatesSummary;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  search: string;
  onSearchChange: (value: string) => void;
  filterType: string;
  onFilterTypeChange: (value: string) => void;
  filterFuelLevel: string;
  onFilterFuelLevelChange: (value: string) => void;
  isLoading: boolean;
  onRefresh?: () => void;
  userId?: string;
}

const FILTER_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: '', label: 'Svi tipovi mašina' },
  { value: 'TRAKTOR', label: 'Traktori' },
  { value: 'KOMBAJN', label: 'Kombajni' },
  { value: 'KAMION', label: 'Kamioni' },
  { value: 'PRIKLJUCAK', label: 'Priključci / Mašine bez goriva' },
  { value: 'VILJUSKAR', label: 'Viljuškari' },
  { value: 'OSTALO', label: 'Ostalo' },
];

const FILTER_FUEL_LEVEL_OPTIONS: CustomSelectOption[] = [
  { value: '', label: 'Svi nivoi goriva' },
  { value: 'LOW', label: '⚠️ Nizak nivo goriva (< 20%)' },
  { value: 'EMPTY', label: '🔴 Prazan rezervoar (0 L)' },
  { value: 'HIGH', label: '🟢 Pun rezervoar (> 80%)' },
  { value: 'NO_FUEL', label: '⚪ Priključci bez rezervoara' },
];

export const StanjeMasinaTab: React.FC<StanjeMasinaTabProps> = ({
  machines,
  pagination,
  summary,
  page,
  pageSize,
  onPageChange,
  search,
  onSearchChange,
  filterType,
  onFilterTypeChange,
  filterFuelLevel,
  onFilterFuelLevelChange,
  isLoading,
  onRefresh,
  userId,
}) => {
  const queryClient = useQueryClient();

  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedMachineForEdit, setSelectedMachineForEdit] = useState<MachineStateItem | null>(null);
  const [machineToDelete, setMachineToDelete] = useState<MachineStateItem | null>(null);

  // Delete mutation (Archives machine)
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/master/machines/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || `Greška pri arhiviranju mašine (${response.status}).`);
      }
      return data;
    },
    onSuccess: () => {
      setMachineToDelete(null);
      onRefresh?.();
      queryClient.invalidateQueries({ queryKey: ['fuel', userId, 'machineStates'] });
      queryClient.invalidateQueries({ queryKey: ['fuel-master', userId, 'machines'] });
      queryClient.invalidateQueries({ queryKey: ['machines'] });
    },
  });

  // KPI Calculations (prefer backend summary across all machines)
  const kpis = useMemo(() => {
    if (summary) return summary;

    let totalFuel = 0;
    let lowFuelCount = 0;
    let activeWithTank = 0;

    machines.forEach((m) => {
      const capacity = m.tankCapacityLiters || 0;
      const fuel = m.currentFuelLiters || 0;
      totalFuel += fuel;

      if (capacity > 0 && m.type !== 'PRIKLJUCAK' && m.fuelType !== 'BEZ_GORIVA') {
        activeWithTank += 1;
        const pct = (fuel / capacity) * 100;
        if (pct < 20) {
          lowFuelCount += 1;
        }
      }
    });

    return {
      totalMachines: machines.length,
      totalFuel: Math.round(totalFuel),
      activeWithTank,
      lowFuelCount,
    };
  }, [summary, machines]);

  // Helper for fuel type label (matches "Seme, djubrivo, hemija.XLS" -> "ulja i gorivo")
  const renderFuelTypeBadge = (fuelType?: string | null, machineType?: string) => {
    if (machineType === 'PRIKLJUCAK' || fuelType === 'BEZ_GORIVA') {
      return <span className={`${styles.badge} ${styles.badgeFuelNone}`}>Bez goriva</span>;
    }
    if (fuelType === 'EURODIZEL ADITIVNI' || fuelType?.includes('122')) {
      return <span className={`${styles.badge} ${styles.badgeFuelAditivni}`}>[122] Eurodizel Aditivni</span>;
    }
    if (fuelType && fuelType !== 'EURODIZEL') {
      return <span className={`${styles.badge} ${styles.badgeFuelEurodizel}`}>{fuelType}</span>;
    }
    return <span className={`${styles.badge} ${styles.badgeFuelEurodizel}`}>[123] Eurodizel</span>;
  };

  // Helper for status badge
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'SLOBODNA':
        return <span className={`${styles.badge} ${styles.badgeSuccess}`}>Slobodna</span>;
      case 'ZADUZENA':
        return <span className={`${styles.badge} ${styles.badgeWarning}`}>Zadužena</span>;
      case 'SERVIS':
        return <span className={`${styles.badge} ${styles.badgeDefault}`}>Na servisu</span>;
      case 'U_KVARU':
        return <span className={`${styles.badge} ${styles.badgeDanger}`}>U kvaru</span>;
      default:
        return <span className={`${styles.badge} ${styles.badgeDefault}`}>{status}</span>;
    }
  };

  return (
    <div className={styles.container}>
      {/* 1. Informacioni Banner */}

      {/* 2. KPI Kartice */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <div className={`${styles.kpiIcon} ${styles.kpiIconGreen}`}>
            <Truck size={24} />
          </div>
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Ukupno mašina</span>
            <span className={styles.kpiValue}>{kpis.totalMachines}</span>
            <span className={styles.kpiSub}>{kpis.activeWithTank} sa rezervoarom</span>
          </div>
        </div>

        <div className={styles.kpiCard}>
          <div className={`${styles.kpiIcon} ${styles.kpiIconBlue}`}>
            <Fuel size={24} />
          </div>
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Gorivo u rezervoarima</span>
            <span className={styles.kpiValue}>{kpis.totalFuel.toLocaleString('sr-RS')} L</span>
            <span className={styles.kpiSub}>Ukupno na stanju flote</span>
          </div>
        </div>

        <div className={styles.kpiCard}>
          <div className={`${styles.kpiIcon} ${kpis.lowFuelCount > 0 ? styles.kpiIconAmber : styles.kpiIconGreen}`}>
            <AlertTriangle size={24} />
          </div>
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Nizak nivo (&lt;20%)</span>
            <span className={styles.kpiValue}>{kpis.lowFuelCount}</span>
            <span className={styles.kpiSub}>
              {kpis.lowFuelCount > 0 ? 'Potrebno dosipanje goriva' : 'Sve mašine imaju goriva'}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Toolbar sa filterima i akcijom Dodavanja */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarFilters}>
          <div className={styles.searchInputWrapper}>
            <Search size={16} className={styles.searchIcon} />
            <input
              type="text"
              placeholder="Pretraži mašinu, model, registraciju..."
              className={styles.searchInput}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label="Pretraga mašina"
            />
          </div>

          <div className={styles.selectWrapper}>
            <CustomSelect
              value={filterType}
              onChange={onFilterTypeChange}
              options={FILTER_TYPE_OPTIONS}
              searchable={false}
            />
          </div>

          <div className={styles.selectWrapper}>
            <CustomSelect
              value={filterFuelLevel}
              onChange={onFilterFuelLevelChange}
              options={FILTER_FUEL_LEVEL_OPTIONS}
              searchable={false}
            />
          </div>
        </div>

        <button
          type="button"
          className={styles.addMachineBtn}
          onClick={() => {
            setSelectedMachineForEdit(null);
            setIsModalOpen(true);
          }}
        >
          <Plus size={18} />
          <span>Dodaj novu mašinu</span>
        </button>
      </div>

      {/* 4. Tabela sa stanjima mašina */}
      <div className={styles.tableContainer}>
        {isLoading ? (
          <div className={styles.emptyState}>
            <RefreshCw size={32} className="animate-spin" color="#16a34a" />
            <div className={styles.emptyTitle}>Učitavanje stanja mašina...</div>
          </div>
        ) : machines.length === 0 ? (
          <div className={styles.emptyState}>
            <Truck size={42} color="#94a3b8" />
            <div className={styles.emptyTitle}>Nema pronađenih mašina</div>
            <p>Pokušajte sa izmenom unetih filtera ili dodajte novu mašinu u flotu.</p>
          </div>
        ) : (
          <>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Mašina & Model</th>
                  <th>Status & Radni sati</th>
                  <th>Vrsta goriva</th>
                  <th>Stanje rezervoara</th>
                  <th>Poslednje punjenje</th>
                  <th>Akcije</th>
                </tr>
              </thead>
              <tbody>
                {machines.map((m) => {
                  const capacity = m.tankCapacityLiters || 0;
                  const fuel = m.currentFuelLiters || 0;
                  const isNoTank = capacity <= 0 || m.type === 'PRIKLJUCAK' || m.fuelType === 'BEZ_GORIVA';
                  const percentage = capacity > 0 ? Math.min(100, Math.round((fuel / capacity) * 100)) : 0;

                  // Color coding for progress bar
                  let fillClass = styles.fillGreen;
                  let pctColor = '#16a34a';
                  if (isNoTank) {
                    fillClass = styles.fillGray;
                    pctColor = '#64748b';
                  } else if (percentage < 20) {
                    fillClass = styles.fillRed;
                    pctColor = '#ef4444';
                  } else if (percentage < 40) {
                    fillClass = styles.fillYellow;
                    pctColor = '#d97706';
                  }

                  // Last refuel date parsing
                  let lastRefuelDateStr = '—';
                  let lastRefuelTimeStr = '';
                  if (m.lastRefueledDate) {
                    const d = new Date(m.lastRefueledDate);
                    if (!isNaN(d.getTime())) {
                      lastRefuelDateStr = d.toLocaleDateString('sr-RS');
                      lastRefuelTimeStr = d.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
                    }
                  }

                  return (
                    <tr key={m.id}>
                      {/* 1. Mašina & Model */}
                      <td>
                        <div className={styles.machineNameCell}>
                          <div className={styles.machineTitleRow}>
                            <span className={styles.machineName}>{m.name}</span>
                            <span className={`${styles.badge} ${styles.badgeType}`}>{m.type}</span>
                          </div>
                          <div className={styles.machineSubtext}>
                            {m.brandModel && <span>{m.brandModel}</span>}
                            {m.brandModel && m.regNumber && <span> • </span>}
                            {m.regNumber && <span>Reg: {m.regNumber}</span>}
                            {m.year && <span> ({m.year})</span>}
                          </div>
                        </div>
                      </td>

                      {/* 2. Status & Radni Sati */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <div>{renderStatusBadge(m.status)}</div>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {m.currentHours !== undefined ? `${m.currentHours} rh` : '0 rh'}
                          </span>
                        </div>
                      </td>

                      {/* 3. Vrsta goriva */}
                      <td>
                        {renderFuelTypeBadge(m.fuelType, m.type)}
                      </td>

                      {/* 4. Stanje rezervoara */}
                      <td>
                        <div className={styles.tankLevelCell}>
                          {isNoTank ? (
                            <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                              Bez motora / rezervoara
                            </div>
                          ) : (
                            <>
                              <div className={styles.tankTextRow}>
                                <div>
                                  <span className={styles.tankNumbers}>{fuel.toLocaleString('sr-RS')} L</span>
                                  <span className={styles.tankCapacity}> / {capacity} L</span>
                                </div>
                                <span className={styles.tankPercentage} style={{ color: pctColor }}>
                                  {percentage}%
                                </span>
                              </div>
                              <div className={styles.progressBarTrack}>
                                <div
                                  className={`${styles.progressBarFill} ${fillClass}`}
                                  style={{ width: `${Math.max(4, percentage)}%` }}
                                />
                              </div>
                            </>
                          )}
                        </div>
                      </td>

                      {/* 5. Poslednje punjenje */}
                      <td>
                        <div className={styles.refuelCell}>
                          {m.lastRefueledDate ? (
                            <>
                              <span className={styles.refuelDate}>
                                {lastRefuelDateStr} {lastRefuelTimeStr && `(${lastRefuelTimeStr})`}
                              </span>
                              <div className={styles.refuelDetails}>
                                {m.lastRefueledLiters && (
                                  <span style={{ fontWeight: 700, color: '#16a34a' }}>
                                    +{m.lastRefueledLiters} L
                                  </span>
                                )}
                                {m.lastRefueledSource && (
                                  <span
                                    className={`${styles.refuelSourceBadge} ${m.lastRefueledSource === 'CISTERNA'
                                      ? styles.sourceCisterna
                                      : m.lastRefueledSource === 'PUMPA'
                                        ? styles.sourcePumpa
                                        : styles.sourceKanister
                                      }`}
                                  >
                                    {m.lastRefueledSource === 'CISTERNA'
                                      ? 'Cisterna'
                                      : m.lastRefueledSource === 'PUMPA'
                                        ? 'Pumpa'
                                        : 'Kanister'}
                                  </span>
                                )}
                                {m.lastRefueledWorker && (
                                  <span>• {m.lastRefueledWorker}</span>
                                )}
                              </div>
                            </>
                          ) : (
                            <span className={styles.noRefuelText}>Nema evidentiranih točenja</span>
                          )}
                        </div>
                      </td>

                      {/* 6. Akcije */}
                      <td>
                        <div className={styles.actionGroup}>
                          <button
                            type="button"
                            className={styles.editBtn}
                            onClick={() => {
                              setSelectedMachineForEdit(m);
                              setIsModalOpen(true);
                            }}
                            title="Izmeni podatke o mašini ili nivo goriva"
                          >
                            <Pencil size={13} />
                            <span>Izmeni</span>
                          </button>

                          <button
                            type="button"
                            className={styles.deleteBtn}
                            onClick={() => setMachineToDelete(m)}
                            title="Arhiviraj / Obriši mašinu"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <TablePagination
              currentPage={page}
              totalPages={pagination?.totalPages || 1}
              totalItems={pagination?.total ?? machines.length}
              pageSize={pageSize}
              onPageChange={onPageChange}
              itemName="mašina"
            />
          </>
        )}
      </div>

      {/* 5. Modal za Dodavanje / Izmenu mašine */}
      <MasinaModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedMachineForEdit(null);
        }}
        onSuccess={() => {
          onRefresh?.();
          queryClient.invalidateQueries({ queryKey: ['fuel', userId, 'machineStates'] });
          queryClient.invalidateQueries({ queryKey: ['fuel-master', userId, 'machines'] });
          queryClient.invalidateQueries({ queryKey: ['machines'] });
        }}
        machine={selectedMachineForEdit}
      />

      {/* 6. Modal za potvrdu Arhiviranja / Brisanja */}
      {machineToDelete && (
        <div className={styles.deleteModalOverlay} onClick={() => setMachineToDelete(null)}>
          <div className={styles.deleteModalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.deleteHeader}>
              <AlertTriangle size={24} />
              <h3 className={styles.deleteTitle}>Arhiviranje mašine</h3>
            </div>

            <div className={styles.deleteWarningBox}>
              Da li ste sigurni da želite da arhivirate mašinu <strong>{machineToDelete.name}</strong>
              {machineToDelete.brandModel ? ` (${machineToDelete.brandModel})` : ''}?
              <br /><br />
              <strong>Važna napomena:</strong> Mašina neće biti trajno izbrisana iz baze.
              Sva istorija točenja goriva, utroška zaliha, radnih naloga i servisa ostaje 100% sačuvana.
              Mašina se samo uklanja iz aktivne upotrebe za nova točenja.
            </div>

            {deleteMutation.isError && (
              <div style={{ color: '#ef4444', fontSize: '0.85rem' }}>
                {(deleteMutation.error as any)?.message || 'Greška pri arhiviranju.'}
              </div>
            )}

            <div className={styles.deleteActions}>
              <button
                type="button"
                className={styles.editBtn}
                onClick={() => setMachineToDelete(null)}
                disabled={deleteMutation.isPending}
              >
                Odustani
              </button>
              <button
                type="button"
                className={styles.confirmDeleteBtn}
                onClick={() => deleteMutation.mutate(machineToDelete.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Arhiviranje...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    <span>Potvrdi arhiviranje</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
