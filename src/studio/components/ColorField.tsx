import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorField({ label, value, onChange }: ColorFieldProps) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  const handleTextChange = (e: ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.trim();
    if (val && !val.startsWith('#')) val = `#${val}`;
    setText(val);
    if (HEX.test(val)) onChange(val.toLowerCase());
  };

  const handleBlur = () => {
    if (!HEX.test(text)) setText(value);
  };

  const handleColorChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toLowerCase();
    setText(val);
    onChange(val);
  };

  const normalizedValue = HEX.test(value) ? value : '#ffffff';

  return (
    <div className="prop-row no-key">
      <span className="prop-label static">{label}</span>
      <div className="colorfield">
        <input
          type="color"
          className="colorfield-swatch"
          value={normalizedValue}
          onChange={handleColorChange}
          title="Choisir une couleur"
          aria-label={`${label} : sélecteur`}
        />
        <input
          type="text"
          className="colorfield-text"
          value={text}
          onChange={handleTextChange}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              if (e.key === 'Escape') setText(value);
              e.currentTarget.blur();
            }
          }}
          placeholder="#ffffff"
          maxLength={7}
          spellCheck={false}
          aria-label={label}
        />
      </div>
    </div>
  );
}
