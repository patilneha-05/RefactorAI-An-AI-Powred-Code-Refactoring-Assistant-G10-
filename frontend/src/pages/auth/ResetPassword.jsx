import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import AuthLayout from '../../components/auth/AuthLayout';
import PasswordInput from '../../components/auth/PasswordInput';
import Button from '../../components/common/Button';
import FormMessage from '../../components/common/FormMessage';
import { Field } from '../../components/common/Input';
import { resetPassword } from '../../services/authService';
import { passwordStrength, validatePassword } from '../../utils/validation';
import { errorMessage } from '../../utils/errors';

/**
 * Complete a password reset using the single-use token from the email link.
 *
 * Token sources supported: `?token=…` (backend default) and `#token=…`.
 * Invalid, expired and already-used tokens are reported by the backend and
 * surfaced here without leaking any additional detail.
 */
export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const token = useMemo(() => {
    const fromQuery = searchParams.get('token');
    if (fromQuery) return fromQuery;
    const hash = location.hash ? location.hash.slice(1) : '';
    return new URLSearchParams(hash).get('token') || '';
  }, [searchParams, location.hash]);

  const [form, setForm] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => passwordStrength(form.password), [form.password]);

  const setField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
    setFormError(null);
  };

  const validate = () => {
    const next = {
      password: validatePassword(form.password),
      confirm:
        !form.confirm
          ? 'Please confirm your new password.'
          : form.confirm !== form.password
            ? 'Passwords do not match.'
            : null,
    };
    setErrors(next);
    return !next.password && !next.confirm;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting || !token) return;
    if (!validate()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await resetPassword({ token, password: form.password });
      setDone(true);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout
        title="Reset link required"
        subtitle="This page needs a valid password reset link."
        footer={
          <p className="auth__switch">
            <Link to="/login">Back to sign in</Link>
          </p>
        }
      >
        <FormMessage
          type="error"
          message="No reset token was found in the link."
          hint="Request a new reset link from the Forgot Password page."
        />
        <Link className="btn btn--primary btn--block" to="/forgot-password">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout
        title="Password updated"
        subtitle="Your password has been reset and existing sessions were signed out."
        footer={
          <p className="auth__switch">
            <Link to="/login">Continue to sign in</Link>
          </p>
        }
      >
        <div className="auth-success" role="status">
          <ShieldCheck size={28} aria-hidden="true" />
          <h2>All set</h2>
          <p>You can now sign in with your new password.</p>
          <Button variant="primary" block onClick={() => navigate('/login', { replace: true })}>
            Go to sign in
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Pick a strong password you haven't used before."
      footer={
        <p className="auth__switch">
          <Link to="/login">Back to sign in</Link>
        </p>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        {formError ? (
          <FormMessage
            type="error"
            message={formError}
            hint="The link may have expired or already been used. Request a new one if needed."
          />
        ) : null}

        <Field label="New password" htmlFor="reset-password" error={errors.password}>
          <PasswordInput
            id="reset-password"
            value={form.password}
            invalid={Boolean(errors.password)}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            onChange={(e) => setField('password', e.target.value)}
          />
        </Field>

        {form.password ? (
          <div className="password-meter" aria-live="polite">
            <div className="password-meter__bars">
              {[0, 1, 2, 3].map((index) => (
                <span
                  key={index}
                  className={`password-meter__bar${index < strength.score ? ' is-on' : ''}`}
                  data-score={strength.score}
                />
              ))}
            </div>
            <span className="password-meter__label">{strength.label}</span>
          </div>
        ) : null}

        <Field label="Confirm new password" htmlFor="reset-confirm" error={errors.confirm}>
          <PasswordInput
            id="reset-confirm"
            value={form.confirm}
            invalid={Boolean(errors.confirm)}
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            onChange={(e) => setField('confirm', e.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" block loading={submitting}>
          Update Password
        </Button>
      </form>
    </AuthLayout>
  );
}
