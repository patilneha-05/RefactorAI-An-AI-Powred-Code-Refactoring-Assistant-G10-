import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AuthLayout from '../../components/auth/AuthLayout';
import PasswordInput from '../../components/auth/PasswordInput';
import GoogleSignInButton from '../../components/auth/GoogleSignInButton';
import Button from '../../components/common/Button';
import FormMessage from '../../components/common/FormMessage';
import { Field, Input } from '../../components/common/Input';
import {
  passwordStrength,
  validateEmail,
  validateName,
  validatePassword,
} from '../../utils/validation';
import { errorMessage } from '../../utils/errors';

export default function Signup() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signup, googleAuth } = useAuth();

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirm: '',
    accepted: false,
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = location.state?.from?.pathname || '/';
  const strength = useMemo(() => passwordStrength(form.password), [form.password]);

  const setField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
    setFormError(null);
  };

  const validate = () => {
    const next = {
      fullName: validateName(form.fullName),
      email: validateEmail(form.email),
      password: validatePassword(form.password),
      confirm:
        !form.confirm
          ? 'Please confirm your password.'
          : form.confirm !== form.password
            ? 'Passwords do not match.'
            : null,
      accepted: form.accepted ? null : 'You must accept the terms to continue.',
    };
    setErrors(next);
    return Object.values(next).every((value) => !value);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await signup({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setFormError({ message: errorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogle = async (idToken) => {
    setSubmitting(true);
    setFormError(null);
    try {
      await googleAuth({ idToken });
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setFormError({ message: errorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start refactoring with AI-powered, multi-agent code review."
      footer={
        <p className="auth__switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        {formError ? <FormMessage type="error" message={formError.message} /> : null}

        <Field label="Full name" htmlFor="signup-name" error={errors.fullName}>
          <Input
            id="signup-name"
            name="fullName"
            type="text"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={form.fullName}
            invalid={Boolean(errors.fullName)}
            onChange={(e) => setField('fullName', e.target.value)}
          />
        </Field>

        <Field label="Email" htmlFor="signup-email" error={errors.email}>
          <Input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={form.email}
            invalid={Boolean(errors.email)}
            onChange={(e) => setField('email', e.target.value)}
          />
        </Field>

        <Field label="Password" htmlFor="signup-password" error={errors.password}>
          <PasswordInput
            id="signup-password"
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
            <ul className="password-meter__rules">
              <li className={strength.checks.length ? 'is-ok' : ''}>
                {strength.checks.length ? '✓' : '•'} 8+ characters
              </li>
              <li className={strength.checks.lowerUpper ? 'is-ok' : ''}>
                {strength.checks.lowerUpper ? '✓' : '•'} upper &amp; lowercase
              </li>
              <li className={strength.checks.number ? 'is-ok' : ''}>
                {strength.checks.number ? '✓' : '•'} a number
              </li>
              <li className={strength.checks.symbol ? 'is-ok' : ''}>
                {strength.checks.symbol ? '✓' : '•'} a symbol
              </li>
            </ul>
          </div>
        ) : null}

        <Field label="Confirm password" htmlFor="signup-confirm" error={errors.confirm}>
          <PasswordInput
            id="signup-confirm"
            value={form.confirm}
            invalid={Boolean(errors.confirm)}
            autoComplete="new-password"
            placeholder="Re-enter your password"
            onChange={(e) => setField('confirm', e.target.value)}
          />
        </Field>

        <label className="auth-checkbox auth-checkbox--terms">
          <input
            type="checkbox"
            checked={form.accepted}
            onChange={(e) => setField('accepted', e.target.checked)}
          />
          <span>
            I agree to the <span className="auth-link">Terms of Service</span> and{' '}
            <span className="auth-link">Privacy Policy</span>.
          </span>
        </label>
        {errors.accepted ? (
          <FormMessage type="error" message={errors.accepted} />
        ) : null}

        <Button type="submit" variant="primary" block loading={submitting}>
          Create Account
        </Button>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <GoogleSignInButton
          label="Sign up with Google"
          onCredential={onGoogle}
          onError={(message) => setFormError(message ? { message } : null)}
          disabled={submitting}
        />
      </form>
    </AuthLayout>
  );
}
