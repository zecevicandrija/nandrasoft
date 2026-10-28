import React, { useState, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowRight,
} from 'lucide-react';
import styles from './TablePagination.module.css';

export interface TablePaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  itemName?: string;
  className?: string;
}

export const TablePagination: React.FC<TablePaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  pageSize = 25,
  onPageChange,
  itemName = 'zapisa',
  className = '',
}) => {
  const [jumpPage, setJumpPage] = useState<string>(String(currentPage));

  useEffect(() => {
    setJumpPage(String(currentPage));
  }, [currentPage]);

  if (totalItems === 0) return null;

  const validTotalPages = Math.max(1, totalPages);
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  // Generisanje brojeva stranica sa elipsama
  const getPageNumbers = (): (number | string)[] => {
    if (validTotalPages <= 7) {
      return Array.from({ length: validTotalPages }, (_, i) => i + 1);
    }
    if (currentPage <= 4) {
      return [1, 2, 3, 4, 5, '...', validTotalPages];
    }
    if (currentPage >= validTotalPages - 3) {
      return [
        1,
        '...',
        validTotalPages - 4,
        validTotalPages - 3,
        validTotalPages - 2,
        validTotalPages - 1,
        validTotalPages,
      ];
    }
    return [
      1,
      '...',
      currentPage - 1,
      currentPage,
      currentPage + 1,
      '...',
      validTotalPages,
    ];
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(jumpPage, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= validTotalPages) {
      if (parsed !== currentPage) {
        onPageChange(parsed);
      }
    } else {
      setJumpPage(String(currentPage));
    }
  };

  return (
    <div className={`${styles.paginationWrapper} ${className}`}>
      {/* Informacije o opsegu stavki */}
      <div className={styles.rangeInfo}>
        Prikazano <strong>{startItem}</strong> – <strong>{endItem}</strong> od ukupno{' '}
        <strong>{totalItems}</strong> {itemName}{' '}
        <span className={styles.pageSizeBadge}>({pageSize} po stranici)</span>
      </div>

      <div className={styles.controlsGroup}>
        {/* Navigaciona dugmad sa brojevima */}
        <div className={styles.navButtons}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => onPageChange(1)}
            disabled={currentPage <= 1}
            title="Prva stranica"
          >
            <ChevronsLeft size={16} />
          </button>

          <button
            type="button"
            className={styles.navTextBtn}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            title="Prethodna stranica"
          >
            <ChevronLeft size={16} />
            <span>Prethodna</span>
          </button>

          <div className={styles.pageNumbers}>
            {getPageNumbers().map((p, idx) =>
              p === '...' ? (
                <span key={`dots-${idx}`} className={styles.ellipsis}>
                  ...
                </span>
              ) : (
                <button
                  key={`page-${p}`}
                  type="button"
                  className={`${styles.pageNumberBtn} ${
                    Number(p) === currentPage ? styles.pageNumberBtnActive : ''
                  }`}
                  onClick={() => onPageChange(Number(p))}
                >
                  {p}
                </button>
              )
            )}
          </div>

          <button
            type="button"
            className={styles.navTextBtn}
            onClick={() => onPageChange(Math.min(validTotalPages, currentPage + 1))}
            disabled={currentPage >= validTotalPages}
            title="Sledeća stranica"
          >
            <span>Sledeća</span>
            <ChevronRight size={16} />
          </button>

          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => onPageChange(validTotalPages)}
            disabled={currentPage >= validTotalPages}
            title="Poslednja stranica"
          >
            <ChevronsRight size={16} />
          </button>
        </div>

        {/* Direktan unos broja stranice */}
        {validTotalPages > 1 && (
          <form onSubmit={handleJumpSubmit} className={styles.jumpForm}>
            <span className={styles.jumpLabel}>Idi na stranu:</span>
            <input
              type="number"
              min={1}
              max={validTotalPages}
              value={jumpPage}
              onChange={(e) => setJumpPage(e.target.value)}
              className={styles.jumpInput}
              aria-label="Broj stranice"
            />
            <span className={styles.jumpTotal}>od {validTotalPages}</span>
            <button type="submit" className={styles.jumpSubmitBtn} title="Skoči na stranu">
              <span>Idi</span>
              <ArrowRight size={12} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default TablePagination;

