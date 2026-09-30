import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import './CheckboxDropdown.css';

// Sélecteur multi-choix à cases à cocher (extrait d'ApercuComptabilisation, TASK-100).
// Toute liste déroulante multi-sélection de l'application réutilise ce composant.
export const CheckboxDropdown = ({
  options,
  selectedValues,
  onChange,
  placeholder,
  disabled = false
}: {
  options: {value: string, label: string}[],
  selectedValues: string[],
  onChange: (vals: string[]) => void,
  placeholder: string,
  disabled?: boolean
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) { setIsOpen(false); setSearch(''); }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggleAll = () => {
    const filteredValues = filteredOptions.map(o => o.value);
    const allSelected = filteredValues.length > 0 && filteredValues.every(v => selectedValues.includes(v));
    if (allSelected) onChange(selectedValues.filter(v => !filteredValues.includes(v)));
    else onChange(Array.from(new Set([...selectedValues, ...filteredValues])));
  };

  const toggleOne = (val: string) => {
    if (selectedValues.includes(val)) onChange(selectedValues.filter(v => v !== val));
    else onChange([...selectedValues, val]);
  };

  return (
    <div ref={containerRef} className="apercu-dropdown">
      <div
        onClick={() => { if (disabled) return; setIsOpen(!isOpen); if (isOpen) setSearch(''); }}
        className="apercu-dropdown-trigger"
        style={disabled ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
      >
        <span title={selectedValues.length === 1 ? options.find(o => o.value === selectedValues[0])?.label : undefined}>
          {selectedValues.length === 0 ? placeholder :
           selectedValues.length === options.length ? 'Tous sélectionnés' :
           selectedValues.length === 1 ? options.find(o => o.value === selectedValues[0])?.label :
           `${selectedValues.length} sélectionnés`}
        </span>
        <ChevronDown size={14} style={{color: 'var(--text-tertiary)', flexShrink: 0}} />
      </div>

      {isOpen && !disabled && (
        <div className="apercu-dropdown-panel">
          <div className="apercu-dropdown-search-box">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="Rechercher..."
              className="apercu-dropdown-search-input"
            />
          </div>
          <div
            onClick={toggleAll}
            className="apercu-dropdown-toggle-all"
          >
            <input type="checkbox" checked={filteredOptions.length > 0 && filteredOptions.every(o => selectedValues.includes(o.value))} readOnly style={{cursor: 'pointer'}} />
            (TOUT SÉLECTIONNER)
          </div>
          {filteredOptions.map(opt => (
            <div
              key={opt.value}
              onClick={() => toggleOne(opt.value)}
              className="apercu-dropdown-item"
            >
              <input type="checkbox" checked={selectedValues.includes(opt.value)} readOnly style={{cursor: 'pointer'}} />
              {opt.label}
            </div>
          ))}
          {filteredOptions.length === 0 && <div className="apercu-dropdown-empty">Aucun élément</div>}
        </div>
      )}
    </div>
  );
};
