import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Topbar from './Topbar';

/**
 * Persistent application shell: the top navigation bar around the routed page.
 *
 * `fullBleed` removes the content padding for app-like screens (Workspace,
 * Settings) that manage their own layout and fill the viewport themselves.
 */
export default function AppLayout({ fullBleed = false }) {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <div className="app-main">
        <Topbar />
        <main
          className={`app-content${fullBleed ? ' app-content--flush' : ''}`}
          id="main-content"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
