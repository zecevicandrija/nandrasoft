import React from 'react';
import { Link } from 'react-router-dom';
import {
  Tractor,
  Wrench,
  Package,
  User,
  MapPin,
  X,
  Play,
  KeyRound,
  Fuel,
  Pencil,
  RotateCcw,
  Trash2,
  Calendar,
  Handshake,
  FlaskConical,
  Sprout,
  Camera,
  QrCode,
  Snowflake,
  CheckCircle2,
  Scale,
  Users,
} from 'lucide-react';
import MachineUsageAction from '../components/MachineUsageAction';
import { materialLabels, materialUnits } from '../lib/workMaterials';
import { formatKgAndTons, getPackingDisplayData } from '../Luk/PackingFields';
import { SERVICE_TYPE_LABELS, type WorkOrder } from './RadniNaloziDashboard';
import styles from './RadniNaloziDashboard.module.css';

const materialDoseFormatter = new Intl.NumberFormat('sr-Latn-RS', { maximumFractionDigits: 12 });
const orderDateFormatter = new Intl.DateTimeFormat('sr-RS', {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});

interface OrderCardProps {
  order: WorkOrder;
  isManager: boolean;
  canEdit: boolean;
  onDetails: (order: WorkOrder) => void;
  onAccept: (order: WorkOrder) => void;
  onOtherComplete: (id: string) => void;
  onUsage: (id: string) => void;
  onEdit: (order: WorkOrder) => void;
  onEditPrefetch?: () => void;
  onCancel: (order: WorkOrder) => void;
  onReactivate: (order: WorkOrder) => void;
  onDelete: (order: WorkOrder) => void;
}

const OrderCard: React.FC<OrderCardProps> = React.memo(({
  order,
  isManager,
  canEdit,
  onDetails,
  onAccept,
  onOtherComplete,
  onUsage,
  onEdit,
  onEditPrefetch,
  onCancel,
  onReactivate,
  onDelete,
}) => {
  const isPacking = order.orderType === 'PAKOVANJE';
  const isRemont = order.orderType === 'REMONT_SERVIS';
  const packing = isPacking
    ? getPackingDisplayData(order.packingPlan, order.plannedLotNumber, order.packingSummary)
    : null;
  const fuelAssignments = (order.machineAssignments || []).filter(
    (a) => !a.voidedAt && a.status !== 'PONISTENA' && (a.startFuelLiters != null || a.endFuelLiters != null)
  );
  const photoCount = (order.photoUrl ? 1 : 0) + (order.fieldWork?.photoUrl ? 1 : 0);

  const packingBadgeText = packing
    ? packing.displayMode !== 'sorting' && packing.totalWeightKg > 0
      ? formatKgAndTons(packing.totalWeightKg)
      : packing.sorting.inputQuantityKg > 0
        ? `Ulaz: ${formatKgAndTons(packing.sorting.inputQuantityKg)}`
        : null
    : null;

  const hasPackingSpecDetails = Boolean(
    packing &&
      ((packing.displayMode !== 'packaging' && packing.sorting.hasAny) ||
        packing.displayMode !== 'sorting' ||
        (packing.notes && packing.notes !== order.instructions))
  );

  return (
    <div className={styles.orderCard}>
      {/* Card Header */}
      <div className={styles.cardHeader}>
        <div className={styles.headerLeft}>
          <button
            type="button"
            className={styles.orderNumberBadge}
            onClick={() => onDetails(order)}
            title="Kliknite za prikaz slika i detalja naloga"
          >
            #{order.orderNumber}
          </button>
          <div className={styles.orderDateRow}>
            <Calendar size={13} className={styles.dateIcon} />
            <span>{orderDateFormatter.format(new Date(order.orderDate))}</span>
          </div>
        </div>

        <div className={styles.headerBadges}>
          <div className={styles.statusAndPriority}>
            {(order.priority === 'KRITICNO' || order.priority === 'KRITICNA') && (
              <span className={styles.priorityBadgeKriticno}>⚡ Kritično</span>
            )}
            {(order.priority === 'HITNO' || order.priority === 'VISOKA') && (
              <span className={styles.priorityBadgeHitno}>
                {order.priority === 'VISOKA' ? '⚠️ Visok' : '⚠️ Hitno'}
              </span>
            )}
            <span className={`${styles.statusBadge} ${styles[`status${order.status}`]}`}>
              <span className={styles.statusDot} />
              {order.status === 'DODELJEN'
                ? 'Dodeljen'
                : order.status === 'U_TOKU'
                  ? 'U toku'
                  : order.status === 'ZAVRSEN'
                    ? 'Završen'
                    : order.status === 'OTKAZAN'
                      ? 'Otkazan'
                      : 'Planiran'}
            </span>
          </div>
          <span
            className={
              isPacking
                ? styles.typeBadgePakovanje
                : isRemont
                  ? styles.typeBadgeRemont
                  : styles.typeBadgeNjiva
            }
          >
            {isPacking ? (
              <>
                <Package size={12} />
                <span>Pakovanje</span>
              </>
            ) : isRemont ? (
              <>
                <Wrench size={12} />
                <span>Remont / Servis</span>
              </>
            ) : (
              <>
                <Tractor size={12} />
                <span>Rad na njivi</span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* Card Body */}
      <div className={styles.orderBody}>
        <div className={styles.metaRowsList}>
          <div className={styles.orderRow}>
            <div className={styles.rowIconWrapper}>
              <User size={15} />
            </div>
            <div className={styles.rowContent}>
              <span className={styles.rowLabel}>Radnik:</span>
              <strong className={styles.rowValue}>{order.worker?.name}</strong>
            </div>
          </div>

          {packing && (
            <>
              <div className={styles.orderRow}>
                <div className={styles.rowIconWrapper}>
                  <QrCode size={15} />
                </div>
                <div className={styles.rowContent}>
                  <span className={styles.rowLabel}>LOT:</span>
                  <strong className={styles.rowValue}>{packing.displayLot}</strong>
                  {(packing.parcelLabel || packing.cropVariety) && (
                    <span className={styles.attachmentText}>
                      • {[packing.parcelLabel, packing.cropVariety].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
              </div>

              {packing.displaySource && (
                <div className={styles.orderRow}>
                  <div className={styles.rowIconWrapper}>
                    <Snowflake size={15} />
                  </div>
                  <div className={styles.rowContent}>
                    <span className={styles.rowLabel}>Komora:</span>
                    <strong className={styles.rowValue}>{packing.displaySource}</strong>
                  </div>
                </div>
              )}

              <div className={`${styles.orderRow} ${styles.jobRow}`}>
                <div className={styles.rowIconWrapper}>
                  <Package size={15} />
                </div>
                <div className={styles.jobDetails}>
                  <div className={styles.jobHeader}>
                    <div className={styles.jobTitle}>
                      <span className={styles.rowLabel}>Posao</span>
                      <strong>{packing.displayModeLabel}</strong>
                    </div>
                    {packingBadgeText && (
                      <span className={styles.packingPlanBadge} title="Planirana ili realizovana masa">
                        {packingBadgeText}
                      </span>
                    )}
                  </div>

                  {hasPackingSpecDetails && (
                    <div className={styles.packingSpecsCard}>
                      {packing.displayMode !== 'packaging' && packing.sorting.hasAny && (
                        <div className={styles.packingSectionBlock}>
                          <span className={styles.materialsLabel}>
                            <Scale size={12} className={styles.inlineMetaIcon} aria-hidden="true" />
                            Sortiranje
                          </span>
                          <div className={styles.packingMetricGrid}>
                            {packing.sorting.inputQuantityKg > 0 && (
                              <div className={styles.packingMetricChip}>
                                <span>Ulaz</span>
                                <strong>{packing.sorting.inputQuantityKg.toLocaleString('sr-RS')} kg</strong>
                              </div>
                            )}
                            {packing.sorting.qualityQuantityKg > 0 && (
                              <div className={styles.packingMetricChip}>
                                <span>I klasa</span>
                                <strong>{packing.sorting.qualityQuantityKg.toLocaleString('sr-RS')} kg</strong>
                              </div>
                            )}
                            {packing.sorting.smallQuantityKg > 0 && (
                              <div className={styles.packingMetricChip}>
                                <span>II klasa</span>
                                <strong>{packing.sorting.smallQuantityKg.toLocaleString('sr-RS')} kg</strong>
                              </div>
                            )}
                            {packing.sorting.wasteQuantityKg > 0 && (
                              <div className={styles.packingMetricChip}>
                                <span>Otpad</span>
                                <strong>{packing.sorting.wasteQuantityKg.toLocaleString('sr-RS')} kg</strong>
                              </div>
                            )}
                            {packing.sorting.plevaKg > 0 && (
                              <div className={styles.packingMetricChip}>
                                <span>Pleva</span>
                                <strong>{packing.sorting.plevaKg.toLocaleString('sr-RS')} kg</strong>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {packing.displayMode !== 'sorting' && (
                        <div className={styles.packingSectionBlock}>
                          <div className={styles.packingSpecHeader}>
                            <span className={styles.packingSpecTitle}>{packing.packageLabel}</span>
                            {packing.packageCount > 0 && (
                              <span className={styles.materialDose}>
                                {packing.packageCount.toLocaleString('sr-RS')} kom × {packing.unitWeightKg} kg
                              </span>
                            )}
                          </div>

                          {(packing.palletsCount > 0 ||
                            packing.palletNumber ||
                            packing.packerCount > 0 ||
                            (packing.responsiblePerson && packing.responsiblePerson !== order.worker?.name)) && (
                            <div className={styles.packingMetaChips}>
                              {packing.palletsCount > 0 && (
                                <span className={styles.packingMetaPill}>
                                  Palete: <strong>{packing.palletsCount}</strong>
                                </span>
                              )}
                              {packing.palletNumber && (
                                <span className={styles.packingMetaPill}>
                                  Oznaka: <strong>{packing.palletNumber}</strong>
                                </span>
                              )}
                              {packing.packerCount > 0 && (
                                <span className={styles.packingMetaPill}>
                                  <Users size={12} aria-hidden="true" />
                                  <strong>{packing.packerCount}</strong> pakera
                                </span>
                              )}
                              {packing.responsiblePerson && packing.responsiblePerson !== order.worker?.name && (
                                <span className={styles.packingMetaPill}>
                                  Zadužen: <strong>{packing.responsiblePerson}</strong>
                                </span>
                              )}
                            </div>
                          )}

                          {packing.packerNotes && (
                            <p className={styles.materialNote}>{packing.packerNotes}</p>
                          )}
                        </div>
                      )}

                      {packing.notes && packing.notes !== order.instructions && (
                        <p className={styles.materialNote}>{packing.notes}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {order.machine && (
            <div className={styles.orderRow}>
              <div className={styles.rowIconWrapper}>
                <Tractor size={15} />
              </div>
              <div className={styles.rowContent}>
                <span className={styles.rowLabel}>Mašina:</span>
                <span className={styles.rowValue}>
                  <strong>{order.machine.name}</strong>
                  {order.attachment && (
                    <span className={styles.attachmentText}> + {order.attachment.name}</span>
                  )}
                </span>
              </div>
            </div>
          )}

          {isRemont && order.maintenance?.serviceType && (
            <div className={styles.orderRow}>
              <div className={styles.rowIconWrapper}>
                <Wrench size={15} />
              </div>
              <div className={styles.rowContent}>
                <span className={styles.rowLabel}>Tip servisa:</span>
                <strong className={styles.rowValue}>
                  {SERVICE_TYPE_LABELS[order.maintenance.serviceType] || order.maintenance.serviceType}
                </strong>
              </div>
            </div>
          )}

          {order.contractor && (
            <div className={styles.orderRow}>
              <div className={styles.rowIconWrapper}><Handshake size={15} aria-hidden="true" /></div>
              <div className={styles.rowContent}>
                <span className={styles.rowLabel}>Kooperant:</span>
                <strong className={styles.rowValue}>{order.contractor.name}</strong>
              </div>
            </div>
          )}

          {order.parcel && (
            <div className={styles.orderRow}>
              <div className={styles.rowIconWrapper}>
                <MapPin size={15} />
              </div>
              <div className={styles.rowContent}>
                <span className={styles.rowLabel}>Parcela:</span>
                <strong className={styles.rowValue}>{order.parcel.name}</strong>
              </div>
            </div>
          )}

          {order.workType && (
            <div className={`${styles.orderRow} ${styles.jobRow}`}>
              <div className={styles.rowIconWrapper}>
                <Wrench size={15} />
              </div>
              <div className={styles.jobDetails}>
                <div className={styles.jobHeader}>
                  <div className={styles.jobTitle}>
                    <span className={styles.rowLabel}>Posao</span>
                    <strong>{order.workType.name}</strong>
                  </div>
                  {order.plannedAreaHa != null && order.plannedAreaHa > 0 && (
                    <span className={styles.planBadge} title="Planirana površina">
                      {materialDoseFormatter.format(order.plannedAreaHa)} ha
                    </span>
                  )}
                </div>
                {!!order.materials?.length && (
                  <div className={styles.jobMaterials}>
                    <span className={styles.materialsLabel}>{materialLabels[order.materials[0].kind]}</span>
                    <ul className={styles.materialList}>
                      {order.materials.map((item) => {
                        const MaterialIcon = item.kind === 'CHEMICAL' ? FlaskConical : Sprout;
                        return (
                          <li className={styles.materialItem} key={`${item.kind}:${item.productId}`}>
                            <MaterialIcon size={14} className={styles.materialIcon} aria-hidden="true" />
                            <div className={styles.materialDetails}>
                              <div className={styles.materialHeading}>
                                <span className={styles.materialName}>{item.name}</span>
                                {item.dosePerHa != null && (
                                  <span
                                    className={styles.materialDose}
                                    aria-label={`Doza: ${materialDoseFormatter.format(item.dosePerHa)} ${materialUnits[item.unit] || item.unit} po hektaru`}
                                  >
                                    {materialDoseFormatter.format(item.dosePerHa)} {materialUnits[item.unit] || item.unit}/ha
                                  </span>
                                )}
                              </div>
                              {item.notes && <p className={styles.materialNote}>{item.notes}</p>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {packing?.isExecuted && (
          <div className={styles.packingExecutionNotice}>
            <CheckCircle2 size={15} className={styles.packingExecutionIcon} aria-hidden="true" />
            <div className={styles.packingExecutionContent}>
              <span>
                Potvrdio/la u magacinu: <strong>{packing.actorName}</strong>
              </span>
              {packing.hasPlanDeviation && (
                <div className={styles.packingDeviationBox}>
                  <span>
                    Planirano: {packing.plannedLot}
                    {packing.plannedSource ? ` · ${packing.plannedSource}` : ''} · {packing.plannedModeLabel}
                  </span>
                  <span>
                    Izvršeno:{' '}
                    <strong>
                      {packing.executedLot || packing.displayLot}
                      {packing.executedSource ? ` · ${packing.executedSource}` : ''} · {packing.executedModeLabel}
                    </strong>
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {fuelAssignments.map((a) => (
          <div key={a.id} className={styles.fuelNotice}>
            <Fuel size={15} className={styles.fuelIcon} aria-hidden="true" />
            <div className={styles.fuelReadings}>
              {fuelAssignments.length > 1 && <strong className={styles.fuelMachineName}>{a.machine?.name || 'Mašina'}</strong>}
              {a.startFuelLiters != null && <span>Gorivo pri preuzimanju: <strong>{materialDoseFormatter.format(a.startFuelLiters)} L</strong></span>}
              {a.endFuelLiters != null && <span>Gorivo pri razduženju: <strong>{materialDoseFormatter.format(a.endFuelLiters)} L</strong></span>}
            </div>
          </div>
        ))}

        {photoCount > 0 && (
          <button
            type="button"
            className={styles.viewPhotosBtn}
            onClick={() => onDetails(order)}
            title="Pregledajte fotografije i detalje ovog radnog naloga"
          >
            <Camera size={15} />
            <span>Pogledaj slike i detalje</span>
            <span className={styles.photoCountBadge}>
              {photoCount} {photoCount === 1 ? 'slika' : 'slike'}
            </span>
          </button>
        )}

        {order.instructions && (
          <div className={styles.instructionsBox}>
            <span className={styles.instructionsQuote}>“</span>
            <span>{order.instructions}</span>
          </div>
        )}
      </div>

      {/* Card Footer / Akcije */}
      <div className={styles.orderCardFooter}>
        <div className={styles.primaryActionWrapper}>
          {!isPacking && !isRemont && (order.status === 'PLANIRAN' || order.status === 'DODELJEN') && (
            <button
              type="button"
              className={styles.acceptOrderBtn}
              onClick={() => onAccept(order)}
            >
              <KeyRound size={16} />
              <span>{isManager ? 'Prihvati u ime radnika' : 'Prihvati nalog i zaduzi'}</span>
            </button>
          )}

          {order.orderType === 'RAD_NJIVA' && order.status === 'U_TOKU' && (
            <Link
              to={`/radovi/novi?orderId=${order.id}&parcelId=${order.parcelId || ''}&machineId=${order.machineId || ''}&attachmentId=${order.attachmentId || ''}&workTypeId=${order.workTypeId || ''}&workerId=${order.workerId}&shift=${order.shift || ''}`}
              className={styles.startWorkBtn}
            >
              <Play size={16} />
              <span>{isManager ? 'Zavrsi u ime radnika' : 'Prijavi rad i razduzi'}</span>
            </Link>
          )}

          {order.orderType === 'OSTALO' && order.status === 'U_TOKU' && (
            <button type="button" className={styles.startWorkBtn} onClick={() => onOtherComplete(order.id)}>
              Zavrsi nalog
            </button>
          )}

          {isPacking && (
            <Link to="/modul-luk?tab=nalozi" className={styles.packingBtn}>
              <Package size={16} />
              <span>Otvori u magacinu</span>
            </Link>
          )}
          {isRemont && order.status !== 'ZAVRSEN' && order.status !== 'OTKAZAN' && (
            <Link
              to={`/masine-kvarovi?orderId=${order.id}&machineId=${order.machineId || ''}`}
              className={styles.workshopBtn}
            >
              <Wrench size={16} />
              <span>Otvori u radionici</span>
            </Link>
          )}
        </div>

        {!isPacking && !isRemont && ['U_TOKU', 'ZAVRSEN'].includes(order.status) && (
          <MachineUsageAction compact onClick={() => onUsage(order.id)} />
        )}

        {isManager && (
          <div className={styles.managerActionsWrapper}>
            {canEdit && (!isPacking || ['DODELJEN', 'PLANIRAN'].includes(order.status)) && (
              <button
                type="button"
                className={styles.editBtn}
                onMouseEnter={onEditPrefetch}
                onFocus={onEditPrefetch}
                onClick={() => onEdit(order)}
                title="Izmeni radni nalog"
              >
                <Pencil size={14} />
                <span>Izmeni</span>
              </button>
            )}

            {order.status !== 'ZAVRSEN' && order.status !== 'OTKAZAN' && (
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => onCancel(order)}
                title="Otkaži nalog"
              >
                <X size={14} />
                <span>Otkaži</span>
              </button>
            )}

            {order.status === 'OTKAZAN' && !order.packingPlan?.cancelledAfterReversal && (
              <button
                type="button"
                className={styles.reactivateBtn}
                onClick={() => onReactivate(order)}
                title="Ponovo aktiviraj nalog"
              >
                <RotateCcw size={14} />
                <span>Aktiviraj</span>
              </button>
            )}

            {!(isPacking && (order.status === 'ZAVRSEN' || order.packingPlan?.cancelledAfterReversal)) && <button
              type="button"
              className={styles.deleteBtn}
              onClick={() => onDelete(order)}
              title="Trajno obriši nalog"
            >
              <Trash2 size={14} />
              <span>Obriši</span>
            </button>}
          </div>
        )}
      </div>
    </div>
  );
});

OrderCard.displayName = 'OrderCard';

export default OrderCard;
