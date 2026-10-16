import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '../common/Input';

/**
 * Password field with a show/hide visibility toggle.
 *
 * Renders inside a `<Field>` like any other input: the accessible name comes
 * from the field's `<label htmlFor>`. The toggle is a real button so it is
 * keyboard reachable, and it reports its state via aria-pressed.
 */
export default function PasswordInput({
  id,
  value,
  onChange,
  invalid = false,
  autoComplete = 'current-password',
  placeholder,
  ...rest
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-input">
      <Input
        id={id}
        name={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        invalid={invalid}
        autoComplete={autoComplete}
        placeholder={placeholder}
        {...rest}
      />
      <button
        type="button"
        className="password-input__toggle"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        tabIndex={0}
      >
        {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}
