import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import styles from './ThemeToggle.module.css';

interface ThemeToggleProps {
  showLabel?: boolean;
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ showLabel = false, className = '' }) => {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === 'light';

  return (
    <button
      type="button"
      className={`${styles.toggleButton} ${className}`}
      onClick={toggleTheme}
      title={isLight ? 'Prebaci na tamnu temu' : 'Prebaci na svetlu temu'}
      aria-label={isLight ? 'Prebaci na tamnu temu' : 'Prebaci na svetlu temu'}
    >
      {isLight ? (
        <Moon className={styles.toggleIcon} size={18} />
      ) : (
        <Sun className={styles.toggleIcon} size={18} />
      )}
      {showLabel && (
        <span className={styles.toggleLabel}>
          {isLight ? 'Tamna tema' : 'Svetla tema'}
        </span>
      )}
    </button>
  );
};

export default ThemeToggle;
