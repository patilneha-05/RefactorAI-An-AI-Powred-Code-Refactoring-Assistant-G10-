import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="page">
      <div className="not-found">
        <div className="not-found__code">404</div>
        <h1 className="not-found__title">Page not found</h1>
        <p className="not-found__text">
          The page you are looking for does not exist or has been moved.
        </p>
        <div className="row">
          <Link className="btn btn--primary" to="/">
            <Compass size={16} aria-hidden="true" />
            Back to dashboard
          </Link>
          <Link className="btn btn--secondary" to="/workspace">
            Open workspace
          </Link>
        </div>
      </div>
    </div>
  );
}
