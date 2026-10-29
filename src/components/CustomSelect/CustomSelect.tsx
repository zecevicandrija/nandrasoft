import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, Check, AlertTriangle } from 'lucide-react';
import styles from './CustomSelect.module.css';

export interface CustomSelectOption {
  value: string;
  label: string;
  subLabel?: string;
  badge?: string;
  badgeType?: 'default' | 'danger' | 'warning' | 'success';
  isAlert?: boolean;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  triggerClassName?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = '— Izaberite opciju —',
  searchable = true,
  disabled = false,
  id,
  className,
  triggerClassName,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpwards, setOpenUpwards] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 220 && rect.top > 220) {
        setOpenUpwards(true);
      } else {
        setOpenUpwards(false);
      }
    }
  }, [isOpen]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && searchable) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    } else {
      setSearch('');
    }
  }, [isOpen, searchable]);

  // Tastatura: zatvaranje na Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.subLabel && opt.subLabel.toLowerCase().includes(q))
    );
  }, [options, search]);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div
      className={`${styles.customSelectContainer} ${isOpen ? styles.customSelectContainerOpen : ''} ${className || ''}`}
      ref={containerRef}
      id={id}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`${styles.customSelectTrigger} ${
          isOpen ? styles.customSelectTriggerOpen : ''
        } ${triggerClassName || ''}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className={styles.customSelectContent}>
          {selectedOption ? (
            <>
              <span className={styles.customSelectMainText}>{selectedOption.label}</span>
              {selectedOption.subLabel && (
                <span className={styles.customSelectSubText}>{selectedOption.subLabel}</span>
              )}
            </>
          ) : (
            <span className={styles.customSelectPlaceholder}>{placeholder}</span>
          )}
        </div>
        <ChevronDown
          size={16}
          className={`${styles.customSelectChevron} ${
            isOpen ? styles.customSelectChevronRotated : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          className={`${styles.customSelectDropdown} ${
            openUpwards ? styles.customSelectDropdownUp : ''
          }`}
          role="listbox"
        >
          {searchable && options.length > 4 && (
            <div className={styles.customSelectSearchWrap}>
              <Search size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
              <input
                ref={searchInputRef}
                type="text"
                className={styles.customSelectSearchInput}
                placeholder="Pretraži..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          <div className={styles.customSelectList}>
            {filteredOptions.length === 0 ? (
              <div className={styles.customSelectEmpty}>Nema pronađenih stavki</div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <div
                    key={opt.value}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt.value)}
                    className={`${styles.customSelectItem} ${
                      isSelected ? styles.customSelectItemActive : ''
                    }`}
                  >
                    <div className={styles.customSelectItemLeft}>
                      <span className={styles.customSelectItemTitle}>{opt.label}</span>
                      {opt.subLabel && (
                        <span className={styles.customSelectItemSub}>{opt.subLabel}</span>
                      )}
                    </div>

                    <div className={styles.customSelectItemRight}>
                      {opt.badge && (
                        <span
                          className={`${styles.badge} ${
                            opt.isAlert
                              ? styles.badgeDanger
                              : opt.badgeType === 'danger'
                              ? styles.badgeDanger
                              : opt.badgeType === 'success'
                              ? styles.badgeSuccess
                              : opt.badgeType === 'warning'
                              ? styles.badgeWarning
                              : styles.badgeDefault
                          }`}
                        >
                          {opt.isAlert && <AlertTriangle size={11} />}
                          {opt.badge}
                        </span>
                      )}
                      {isSelected && (
                        <Check size={16} color="#16a34a" style={{ flexShrink: 0 }} />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomSelect;

