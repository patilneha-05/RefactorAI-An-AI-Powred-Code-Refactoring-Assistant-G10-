import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AuthLayout from '../../components/auth/AuthLayout';
import PasswordInput from '../../components/auth/PasswordInput';
import GoogleSignInButton from '../../components/auth/GoogleSignInButton';
import Button from '../../components/common/Button';
import FormMessage from '../../components/common/FormMessage';
import { Field, Input } from '../../components/common/Input';
import { validateEmail, validatePassword } from '../../utils/validation';
import { errorMessage, errorHint } from '../../utils/errors';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, googleAuth } = useAuth();

  const [form, setForm] = useState({ email: '', password: '', rememberMe: true });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = location.state?.from?.pathname || '/';

  const setField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
    setFormError(null);
  };

  const validate = () => {
    const next = {
      email: validateEmail(form.email),
      password: validatePassword(form.password),
    };
    setErrors(next);
    return !next.email && !next.password;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await login({
        email: form.email.trim(),
        password: form.password,
        rememberMe: form.rememberMe,
      });
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setFormError({ message: errorMessage(error), hint: errorHint(error) });
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
      setFormError({ message: errorMessage(error), hint: errorHint(error) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your AI-powered code refactoring workspace."
      footer={
        <p className="auth__switch">
          New to RefactorAI? <Link to="/signup">Create an account</Link>
        </p>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        {formError ? (
          <FormMessage type="error" message={formError.message} hint={formError.hint} />
        ) : null}

        <Field label="Email" htmlFor="login-email" error={errors.email}>
          <Input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={form.email}
            invalid={Boolean(errors.email)}
            onChange={(e) => setField('email', e.target.value)}
          />
        </Field>

        <Field label="Password" htmlFor="login-password" error={errors.password}>
          <PasswordInput
            id="login-password"
            value={form.password}
            invalid={Boolean(errors.password)}
            autoComplete="current-password"
            placeholder="••••••••"
            onChange={(e) => setField('password', e.target.value)}
          />
        </Field>

        <div className="auth-form__row">
          <label className="auth-checkbox">
            <input
              type="checkbox"
              checked={form.rememberMe}
              onChange={(e) => setField('rememberMe', e.target.checked)}
            />
            <span>Remember me</span>
          </label>
          <Link className="auth-link" to="/forgot-password">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" variant="primary" block loading={submitting}>
          Sign In
        </Button>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <GoogleSignInButton
          onCredential={onGoogle}
          onError={(message) =>
            setFormError(message ? { message } : null)
          }
          disabled={submitting}
        />
      </form>
    </AuthLayout>
  );
}
