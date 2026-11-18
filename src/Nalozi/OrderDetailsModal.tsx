import React, { useState, useEffect } from 'react';
import {
  X,
  ExternalLink,
  Maximize2,
  Calendar,
  Clock,
  User,
  Tractor,
  Wrench,
  MapPin,
  Handshake,
  Fuel,
  Gauge,
  ClipboardList,
  Camera,
  FlaskConical,
  Sprout,
  CheckCircle2,
  Pencil,
  Info,
  Layers,
} from 'lucide-react';
import { materialLabels, materialUnits } from '../lib/workMaterials';
import { SERVICE_TYPE_LABELS, type WorkOrder } from './RadniNaloziDashboard';
import styles from './OrderDetailsModal.module.css';

interface OrderDetailsModalProps {
  order: WorkOrder;
  onClose: () => void;
  onEdit?: (order: WorkOrder) => void;
  canEdit?: boolean;
}

const materialDoseFormatter = new Intl.NumberFormat('sr-Latn-RS', { maximumFractionDigits: 12 });

const shiftLabels: Record<string, string> = {
  PRVA: '1. Smena',
  DRUGA: '2. Smena',
  TRECA: '3. Smena',
};

const statusLabels: Record<string, string> = {
  PLANIRAN: 'Planiran',
  DODELJEN: 'Dodeljen',
  U_TOKU: 'U toku',
  ZAVRSEN: 'Završen',
  OTKAZAN: 'Otkazan',
};

const typeLabels: Record<string, string> = {
  RAD_NJIVA: 'Rad na njivi',
  REMONT_SERVIS: 'Remont / Servis',
  OSTALO: 'Ostalo',
};

export const OrderDetailsModal: React.FC<OrderDetailsModalProps> = ({
  order,
  onClose,
  onEdit,
  canEdit = false,
}) => {
  const [lightboxImage, setLightboxImage] = useState<{ url: string; label: string } | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxImage) {
          setLightboxImage(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImage, onClose]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('sr-RS', {
        weekday: 'short',
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleString('sr-RS', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const isRemont = order.orderType === 'REMONT_SERVIS';
  const hasOrderPhoto = Boolean(order.photoUrl);
  const hasFieldWorkPhoto = Boolean(order.fieldWork?.photoUrl);
  const totalPhotos = (hasOrderPhoto ? 1 : 0) + (hasFieldWorkPhoto ? 1 : 0);

  const startFuel = order.machineAssignments?.[0]?.startFuelLiters;
  const startHours = order.machineAssignments?.[0]?.startHours;

  return (
    <>
      <div className={styles.modalBackdrop} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="order-details-title">
        <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className={styles.modalHeader}>
            <div className={styles.modalTitleGroup}>
              <ClipboardList className={styles.titleIcon} size={22} />
              <h3 id="order-details-title" className={styles.modalTitle}>
                Radni Nalog #{order.orderNumber}
              </h3>
            </div>
            <button
              type="button"
              className={styles.modalCloseBtn}
              onClick={onClose}
              title="Zatvori (Esc)"
              aria-label="Zatvori"
            >
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div className={styles.modalBody}>
            {/* Meta Badges Ribbon */}
            <div className={styles.metaBadgesRow}>
              {/* Status */}
              <span className={`${styles.statusBadge} ${styles[`status${order.status}`]}`}>
                <span className={styles.statusDot} />
                {statusLabels[order.status] || order.status}
              </span>

              {/* Priority */}
              {(order.priority === 'KRITICNO' || order.priority === 'KRITICNA') && (
                <span className={styles.priorityBadgeKriticno}>⚡ Kritično</span>
              )}
              {(order.priority === 'HITNO' || order.priority === 'VISOKA') && (
                <span className={styles.priorityBadgeHitno}>
                  {order.priority === 'VISOKA' ? '⚠️ Visok' : '⚠️ Hitno'}
                </span>
              )}

              {/* Type */}
              <span className={styles.metaPill}>
                {isRemont ? <Wrench size={13} /> : <Tractor size={13} />}
                <span>{typeLabels[order.orderType] || order.orderType}</span>
              </span>

              {/* Shift */}
              <span className={styles.metaPill}>
                <Clock size={13} />
                <span>{shiftLabels[order.shift] || order.shift}</span>
              </span>

              {/* Date */}
              <span className={styles.metaPill}>
                <Calendar size={13} />
                <span>{formatDate(order.orderDate)}</span>
              </span>
            </div>

            {/* FOTOGRAFIJE SEKCIJA */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h4 className={styles.sectionTitle}>
                  <Camera className={styles.sectionIcon} size={18} />
                  <span>Priložene fotografije</span>
                </h4>
                {totalPhotos > 0 && (
                  <span className={styles.sectionCountBadge}>
                    {totalPhotos} {totalPhotos === 1 ? 'fotografija' : 'fotografije'}
                  </span>
                )}
              </div>

              {totalPhotos > 0 ? (
                <div className={styles.photosGrid}>
                  {hasOrderPhoto && order.photoUrl && (
                    <div className={styles.photoCard}>
                      <div className={styles.photoCardHeader}>
                        <h5 className={styles.photoCardTitle}>
                          <Camera size={14} />
                          <span>Fotografija uz nalog</span>
                        </h5>
                        <span className={styles.photoBadge}>Izdavanje</span>
                      </div>
                      <div
                        className={styles.photoWrapper}
                        onClick={() => setLightboxImage({ url: order.photoUrl!, label: 'Fotografija uz nalog' })}
                        title="Kliknite za uvećani prikaz"
                      >
                        <img
                          src={order.photoUrl}
                          alt="Fotografija uz nalog"
                          className={styles.photoImg}
                          loading="lazy"
                        />
                        <div className={styles.zoomOverlay}>
                          <Maximize2 size={16} />
                          <span>Kliknite za uvećanje</span>
                        </div>
                      </div>
                      <div className={styles.photoActions}>
                        <button
                          type="button"
                          className={styles.zoomBtn}
                          onClick={() => setLightboxImage({ url: order.photoUrl!, label: 'Fotografija uz nalog' })}
                        >
                          <Maximize2 size={13} />
                          <span>Uvećaj</span>
                        </button>
                        <a
                          href={order.photoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.openFullBtn}
                          title="Otvori originalnu sliku u punoj rezoluciji u novom tabu"
                        >
                          <ExternalLink size={13} />
                          <span>Puna rezolucija</span>
                        </a>
                      </div>
                    </div>
                  )}

                  {hasFieldWorkPhoto && order.fieldWork?.photoUrl && (
                    <div className={styles.photoCard}>
                      <div className={styles.photoCardHeader}>
                        <h5 className={styles.photoCardTitle}>
                          <CheckCircle2 size={14} color="#10b981" />
                          <span>Fotografija završenog rada</span>
                        </h5>
                        <span className={`${styles.photoBadge} ${styles.photoBadgeDone}`}>Realizacija</span>
                      </div>
                      <div
                        className={styles.photoWrapper}
                        onClick={() => setLightboxImage({ url: order.fieldWork!.photoUrl!, label: 'Fotografija završenog rada' })}
                        title="Kliknite za uvećani prikaz"
                      >
                        <img
                          src={order.fieldWork.photoUrl}
                          alt="Fotografija završenog rada"
                          className={styles.photoImg}
                          loading="lazy"
                        />
                        <div className={styles.zoomOverlay}>
                          <Maximize2 size={16} />
                          <span>Kliknite za uvećanje</span>
                        </div>
                      </div>
                      <div className={styles.photoActions}>
                        <button
                          type="button"
                          className={styles.zoomBtn}
                          onClick={() => setLightboxImage({ url: order.fieldWork!.photoUrl!, label: 'Fotografija završenog rada' })}
                        >
                          <Maximize2 size={13} />
                          <span>Uvećaj</span>
                        </button>
                        <a
                          href={order.fieldWork.photoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.openFullBtn}
                          title="Otvori originalnu sliku u punoj rezoluciji u novom tabu"
                        >
                          <ExternalLink size={13} />
                          <span>Puna rezolucija</span>
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.noPhotosNotice}>
                  <Camera size={18} />
                  <span>Nema priloženih fotografija za ovaj radni nalog.</span>
                </div>
              )}
            </div>

            {/* DETALJI NALOGA GRID */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h4 className={styles.sectionTitle}>
                  <ClipboardList className={styles.sectionIcon} size={18} />
                  <span>Osnovni podaci naloga</span>
                </h4>
              </div>

              <div className={styles.infoGrid}>
                {/* Radnik */}
                <div className={styles.infoCard}>
                  <div className={styles.infoIconWrapper}>
                    <User size={18} />
                  </div>
                  <div className={styles.infoContent}>
                    <span className={styles.infoLabel}>Radnik</span>
                    <span className={styles.infoValue}>{order.worker?.name || '-'}</span>
                  </div>
                </div>

                {/* Kooperant */}
                {order.contractor && (
                  <div className={styles.infoCard}>
                    <div className={styles.infoIconWrapper}>
                      <Handshake size={18} />
                    </div>
                    <div className={styles.infoContent}>
                      <span className={styles.infoLabel}>Kooperant</span>
                      <span className={styles.infoValue}>{order.contractor.name}</span>
                    </div>
                  </div>
                )}

                {/* Parcela */}
                {order.parcel && (
                  <div className={styles.infoCard}>
                    <div className={styles.infoIconWrapper}>
                      <MapPin size={18} />
                    </div>
                    <div className={styles.infoContent}>
                      <span className={styles.infoLabel}>Parcela</span>
                      <span className={styles.infoValue}>
                        {order.parcel.name}
                        {order.parcel.code && <span className={styles.infoValueSub}>({order.parcel.code})</span>}
                      </span>
                    </div>
                  </div>
                )}

                {/* Mašina i priključak */}
                {order.machine && (
                  <div className={styles.infoCard}>
                    <div className={styles.infoIconWrapper}>
                      <Tractor size={18} />
                    </div>
                    <div className={styles.infoContent}>
                      <span className={styles.infoLabel}>Mašina</span>
                      <span className={styles.infoValue}>
                        {order.machine.name}
                        {order.attachment && (
                          <span className={styles.infoValueSub}>+ {order.attachment.name}</span>
                        )}
                      </span>
                    </div>
                  </div>
                )}

                {/* Tip servisa */}
                {isRemont && order.maintenance?.serviceType && (
                  <div className={styles.infoCard}>
                    <div className={styles.infoIconWrapper}>
                      <Wrench size={18} />
                    </div>
                    <div className={styles.infoContent}>
                      <span className={styles.infoLabel}>Tip servisa</span>
                      <span className={styles.infoValue}>
                        {SERVICE_TYPE_LABELS[order.maintenance.serviceType] || order.maintenance.serviceType}
                      </span>
                    </div>
                  </div>
                )}

                {/* Posao */}
                {order.workType && (
                  <div className={styles.infoCard}>
                    <div className={styles.infoIconWrapper}>
                      <Layers size={18} />
                    </div>
                    <div className={styles.infoContent}>
                      <span className={styles.infoLabel}>Posao / Operacija</span>
                      <span className={styles.infoValue}>{order.workType.name}</span>
                    </div>
                  </div>
                )}

                {/* Planirana površina */}
                {order.plannedAreaHa != null && order.plannedAreaHa > 0 && (
                  <div className={styles.infoCard}>
                    <div className={styles.infoIconWrapper}>
                      <MapPin size={18} />
                    </div>
                    <div className={styles.infoContent}>
                      <span className={styles.infoLabel}>Planirana površina</span>
                      <span className={styles.infoValue}>
                        {materialDoseFormatter.format(order.plannedAreaHa)} ha
                      </span>
                    </div>
                  </div>
                )}

                {/* Zaduženo gorivo */}
                {startFuel !== undefined && startFuel !== null && (
                  <div className={styles.infoCard}>
                    <div className={styles.infoIconWrapper}>
                      <Fuel size={18} />
                    </div>
                    <div className={styles.infoContent}>
                      <span className={styles.infoLabel}>Zaduženo gorivo</span>
                      <span className={styles.infoValue}>{startFuel} L</span>
                    </div>
                  </div>
                )}

                {/* Početni radni sati */}
                {startHours !== undefined && startHours !== null && (
                  <div className={styles.infoCard}>
                    <div className={styles.infoIconWrapper}>
                      <Gauge size={18} />
                    </div>
                    <div className={styles.infoContent}>
                      <span className={styles.infoLabel}>Početni radni sati</span>
                      <span className={styles.infoValue}>{startHours} h</span>
                    </div>
                  </div>
                )}

                {/* Izdao nalog */}
                {order.issuedBy && (
                  <div className={styles.infoCard}>
                    <div className={styles.infoIconWrapper}>
                      <Info size={18} />
                    </div>
                    <div className={styles.infoContent}>
                      <span className={styles.infoLabel}>Izdao nalog</span>
                      <span className={styles.infoValue}>
                        {order.issuedBy.name}
                        {order.issuedBy.role && (
                          <span className={styles.infoValueSub}>({order.issuedBy.role})</span>
                        )}
                      </span>
                    </div>
                  </div>
                )}

                {/* Kreiran */}
                {order.createdAt && (
                  <div className={styles.infoCard}>
                    <div className={styles.infoIconWrapper}>
                      <Calendar size={18} />
                    </div>
                    <div className={styles.infoContent}>
                      <span className={styles.infoLabel}>Datum kreiranja</span>
                      <span className={styles.infoValue}>{formatDateTime(order.createdAt)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* MATERIJALI */}
            {order.materials && order.materials.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h4 className={styles.sectionTitle}>
                    {order.materials[0].kind === 'CHEMICAL' ? (
                      <FlaskConical className={styles.sectionIcon} size={18} />
                    ) : (
                      <Sprout className={styles.sectionIcon} size={18} />
                    )}
                    <span>Planirani materijali ({materialLabels[order.materials[0].kind] || 'Materijali'})</span>
                  </h4>
                </div>

                <ul className={styles.materialsList}>
                  {order.materials.map((item) => {
                    const MaterialIcon = item.kind === 'CHEMICAL' ? FlaskConical : Sprout;
                    return (
                      <li key={`${item.kind}:${item.productId}`} className={styles.materialItem}>
                        <div className={styles.materialIconWrapper}>
                          <MaterialIcon size={16} />
                        </div>
                        <div className={styles.materialDetails}>
                          <div className={styles.materialTop}>
                            <span className={styles.materialName}>{item.name}</span>
                            {item.dosePerHa != null && (
                              <span className={styles.materialDoseBadge}>
                                Doza: {materialDoseFormatter.format(item.dosePerHa)}{' '}
                                {materialUnits[item.unit] || item.unit}/ha
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

            {/* REALIZACIJA RADA NA TERENU */}
            {order.fieldWork && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h4 className={styles.sectionTitle}>
                    <CheckCircle2 className={styles.sectionIcon} size={18} />
                    <span>Realizacija rada na terenu</span>
                  </h4>
                </div>

                <div className={styles.realizationGrid}>
                  {order.fieldWork.areaDoneHa != null && (
                    <div className={styles.realizationCard}>
                      <span className={styles.realizationLabel}>Urađena površina</span>
                      <span className={styles.realizationValue}>
                        {materialDoseFormatter.format(order.fieldWork.areaDoneHa)} ha
                      </span>
                    </div>
                  )}

                  {order.fieldWork.workHours != null && (
                    <div className={styles.realizationCard}>
                      <span className={styles.realizationLabel}>Utrošeni radni sati</span>
                      <span className={styles.realizationValue}>{order.fieldWork.workHours} h</span>
                    </div>
                  )}

                  {order.fieldWork.status && (
                    <div className={styles.realizationCard}>
                      <span className={styles.realizationLabel}>Status realizacije</span>
                      <span className={styles.realizationValue}>{order.fieldWork.status}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* INSTRUKCIJE / NAPOMENE ZA RADNIKA */}
            {order.instructions && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h4 className={styles.sectionTitle}>
                    <Info className={styles.sectionIcon} size={18} />
                    <span>Instrukcije i napomene za radnika</span>
                  </h4>
                </div>
                <div className={styles.instructionsCard}>
                  <span className={styles.instructionsQuote}>“</span>
                  <span>{order.instructions}</span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={styles.modalFooter}>
            <button type="button" className={styles.closeBtn} onClick={onClose}>
              Zatvori
            </button>
            {canEdit && onEdit && (
              <button
                type="button"
                className={styles.editBtn}
                onClick={() => {
                  onClose();
                  onEdit(order);
                }}
              >
                <Pencil size={15} />
                <span>Izmeni nalog</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* LIGHTBOX MODAL */}
      {lightboxImage && (
        <div
          className={styles.lightboxOverlay}
          onClick={() => setLightboxImage(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className={styles.lightboxHeader} onClick={(e) => e.stopPropagation()}>
            <span className={styles.lightboxTitle}>
              <Camera size={18} />
              <span>{lightboxImage.label} - Nalog #{order.orderNumber}</span>
            </span>
            <div className={styles.lightboxControls}>
              <a
                href={lightboxImage.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.lightboxActionBtn}
                title="Otvori u novom prozoru"
              >
                <ExternalLink size={14} />
                <span>Otvori u punoj rezoluciji</span>
              </a>
              <button
                type="button"
                className={styles.lightboxActionBtn}
                onClick={() => setLightboxImage(null)}
                title="Zatvori uvećanje (Esc)"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className={styles.lightboxImageContainer} onClick={(e) => e.stopPropagation()}>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.label}
              className={styles.lightboxImg}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default OrderDetailsModal;
