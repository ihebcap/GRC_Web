import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Filter, Search, Loader2 } from 'lucide-react';

export function ExcelFilter({ filterType, options, selectedValues, textValue, onChange }: { columnKey?: string, filterType: 'list' | 'text' | 'number' | 'date', options?: {label: string, value: string}[], selectedValues?: string[], textValue?: string, onChange: (val: any) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [localText, setLocalText] = useState(textValue || '');
  // Filtres de plage (number/date) encodés sous la forme "min~max"
  const [rangeMin, setRangeMin] = useState('');
  const [rangeMax, setRangeMax] = useState('');
  const [isOpening, setIsOpening] = useState(false);
  const [pos, setPos] = useState<{top: number, left: number}>({top: 0, left: 0});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const POPUP_WIDTH = 250;

  const computePosition = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    // Anchor below the button, but keep the popup within the viewport horizontally.
    let left = rect.left;
    if (left + POPUP_WIDTH > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - POPUP_WIDTH - 8);
    }
    setPos({ top: rect.bottom + 4, left });
  };

  useLayoutEffect(() => {
    if (isOpen) computePosition();
  }, [isOpen]);

  // Synchronise les champs de plage et de texte avec la valeur stockée à l'ouverture
  useEffect(() => {
    const [min, max] = (textValue || '').split('~');
    setRangeMin(min || '');
    setRangeMax(max || '');
    setLocalText(textValue || '');
  }, [textValue, isOpen]);

  const applyRange = () => {
    const min = rangeMin.trim();
    const max = rangeMax.trim();
    onChange(min || max ? `${min}~${max}` : '');
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleReposition = () => computePosition();
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [isOpen]);

  const filteredOptions = React.useMemo(() => {
    if (!isOpen) return [];
    return (options || []).filter(o =>
      (o.label || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (o.value || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [options, searchTerm, isOpen]);

  const handleToggleAll = () => {
    if (!options || !selectedValues) return;
    if (selectedValues.length === options.length) onChange([]);
    else onChange(options.map(o => o.value));
  };

  const handleToggleOne = (val: string) => {
    if (!selectedValues) return;
    if (selectedValues.includes(val)) onChange(selectedValues.filter(v => v !== val));
    else onChange([...selectedValues, val]);
  };

  const isActive = filterType === 'list' ? (selectedValues && selectedValues.length > 0) : !!textValue;

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOpen) {
      setIsOpening(true);
      setIsOpen(true);
      setTimeout(() => setIsOpening(false), 20); // allow browser to render popup then compute large list
    } else {
      setIsOpen(false);
    }
  };

  const popup = isOpen ? createPortal(
    <div
      ref={popupRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000,
        direction: 'ltr', textAlign: 'left', fontWeight: 'normal',
        background: 'white', border: '1px solid var(--border-color)', borderRadius: '4px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '0.5rem', width: `${POPUP_WIDTH}px`, cursor: 'default'
      }}
    >
      {filterType === 'list' ? (
        isOpening ? (
          <div style={{padding: '2rem', textAlign: 'center'}}><Loader2 className="animate-spin" size={24} style={{color: 'var(--accent-primary)', margin: '0 auto'}} /></div>
        ) : (
        <>
          <div style={{display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '0.5rem'}}>
            <Search size={14} style={{color: 'var(--text-secondary)', marginRight: '0.5rem', flexShrink: 0}} />
            <input type="text" placeholder="Rechercher..." autoFocus value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{border: 'none', outline: 'none', width: '100%', fontSize: '0.75rem', direction: 'ltr', textAlign: 'left'}} />
          </div>
          <div style={{maxHeight: '220px', overflowY: 'auto', overflowX: 'hidden', display: 'block', textAlign: 'left'}}>
            <label style={{display: 'block', textAlign: 'left', fontSize: '0.75rem', cursor: 'pointer', paddingBottom: '8px', borderBottom: '1px solid var(--bg-secondary)', marginBottom: '4px'}}>
              <input type="checkbox" style={{marginRight: '8px', verticalAlign: 'middle'}} checked={selectedValues?.length === options?.length} onChange={handleToggleAll} />
              <strong style={{verticalAlign: 'middle'}}>(Tout sélectionner)</strong>
            </label>
            {filteredOptions.slice(0, 200).map(o => (
              <label key={o.value} style={{display: 'block', textAlign: 'left', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 400, padding: '4px 0'}}>
                <input type="checkbox" style={{marginRight: '8px', verticalAlign: 'middle'}} checked={selectedValues?.includes(o.value)} onChange={() => handleToggleOne(o.value)} />
                <span style={{wordBreak: 'break-word', verticalAlign: 'middle'}}>{o.label || '(Vide)'}</span>
              </label>
            ))}
            {filteredOptions.length > 200 && (
               <span style={{display: 'block', textAlign: 'left', fontSize: '0.65rem', color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '4px 0'}}>
                 ... +{filteredOptions.length - 200} résultats (utilisez la recherche)
               </span>
            )}
          </div>
        </>
        )
      ) : filterType === 'number' ? (
        <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
          <span style={{fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)'}}>Plage de montant</span>
          <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
            <input type="number" step="any" placeholder="Min" value={rangeMin} onChange={e => setRangeMin(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyRange(); }} className="form-input" style={{fontSize: '0.75rem', padding: '0.25rem 0.5rem', width: '100%', direction: 'ltr', textAlign: 'left'}} />
            <span style={{color: 'var(--text-tertiary)'}}>—</span>
            <input type="number" step="any" placeholder="Max" value={rangeMax} onChange={e => setRangeMax(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyRange(); }} className="form-input" style={{fontSize: '0.75rem', padding: '0.25rem 0.5rem', width: '100%', direction: 'ltr', textAlign: 'left'}} />
          </div>
        </div>
      ) : filterType === 'date' ? (
        <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
          <span style={{fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)'}}>Période</span>
          <label style={{fontSize: '0.7rem', color: 'var(--text-secondary)'}}>Du
            <input type="date" value={rangeMin} onChange={e => setRangeMin(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyRange(); }} className="form-input" style={{fontSize: '0.75rem', padding: '0.25rem 0.5rem', width: '100%', direction: 'ltr'}} />
          </label>
          <label style={{fontSize: '0.7rem', color: 'var(--text-secondary)'}}>Au
            <input type="date" value={rangeMax} onChange={e => setRangeMax(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyRange(); }} className="form-input" style={{fontSize: '0.75rem', padding: '0.25rem 0.5rem', width: '100%', direction: 'ltr'}} />
          </label>
        </div>
      ) : (
        <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
          <span style={{fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)'}}>Filtre de texte / expression</span>
          <input type="text" placeholder="Filtrer..." value={localText} onChange={e => setLocalText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { onChange(localText); setIsOpen(false); } }} className="form-input" style={{fontSize: '0.75rem', padding: '0.25rem 0.5rem', direction: 'ltr', textAlign: 'left'}} />
        </div>
      )}

      <div style={{display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)'}}>
        <button onClick={() => { onChange(filterType === 'list' ? [] : ''); setLocalText(''); setRangeMin(''); setRangeMax(''); setIsOpen(false); }} style={{fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer'}}>Effacer</button>
        <button onClick={() => { if (filterType === 'text') { onChange(localText); setIsOpen(false); } else if (filterType === 'number' || filterType === 'date') { applyRange(); } else { setIsOpen(false); } }} style={{fontSize: '0.75rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer'}}>{filterType === 'list' ? 'Fermer' : 'Appliquer'}</button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div style={{position: 'relative', display: 'inline-block', marginLeft: '0.5rem'}} onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        style={{
          background: isActive ? 'var(--accent-primary, #4f46e5)' : 'none',
          border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px',
          color: isActive ? 'white' : 'var(--text-secondary)'
        }}
        title={isActive ? 'Filtre actif' : 'Filtrer'}
      >
        <Filter size={14} />
      </button>
      {popup}
    </div>
  );
}