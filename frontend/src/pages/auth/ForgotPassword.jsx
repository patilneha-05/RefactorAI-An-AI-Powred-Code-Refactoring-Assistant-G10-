import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import AuthLayout from '../../components/auth/AuthLayout';
import Button from '../../components/common/Button';
import FormMessage from '../../components/common/FormMessage';
import { Field, Input } from '../../components/common/Input';
import { forgotPassword } from '../../services/authService';
import { validateEmail } from '../../utils/validation';
import { errorMessage } from '../../utils/errors';

/**
 * Request a password-reset link.
 *
 * The backend always answers with the same generic message whether or not the
 * email exists, so this page never reveals account existence.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    const emailError = validateEmail(email);
    if (emailError) {
      setFieldError(emailError);
      return;
    }
    setFieldError(null);
    setFormError(null);
    setSubmitting(true);
    try {
      await forgotPassword({ email: email.trim() });
      setSent(true);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter the email on your account and we'll send a secure reset link."
      footer={
        <p className="auth__switch">
          Remembered it? <Link to="/login">Back to sign in</Link>
        </p>
      }
    >
      {sent ? (
        <div className="auth-success" role="status">
          <MailCheck size={28} aria-hidden="true" />
          <h2>Check your inbox</h2>
          <p>
            If an account exists for <strong>{email.trim()}</strong>, a password reset link
            is on its way. The link expires shortly and can be used once.
          </p>
          <Link className="btn btn--secondary btn--block" to="/login">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          {formError ? <FormMessage type="error" message={formError} /> : null}

          <Field label="Email" htmlFor="forgot-email" error={fieldError}>
            <Input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              invalid={Boolean(fieldError)}
              onChange={(e) => {
                setEmail(e.target.value);
                setFieldError(null);
                setFormError(null);
              }}
            />
          </Field>

          <Button type="submit" variant="primary" block loading={submitting}>
            Send Reset Link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
