import { Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import Launcher from './pages/Launcher';
import Projects from './pages/Projects';
import Workspace from './pages/Workspace';
import Suggestions from './pages/Suggestions';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      {/* Dashboard (Launcher) — the only screen without a navigation bar. */}
      <Route path="/" element={<Launcher />} />

      {/* The workspace's own `ws-topbar` (FILE / EDIT / VIEW / WINDOW) is its
          navigation bar, so no separate app nav bar is stacked above it. */}
      <Route path="/workspace" element={<Workspace />} />

      <Route element={<AppLayout />}>
        <Route path="/projects" element={<Projects />} />
        <Route path="/suggestions" element={<Suggestions />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      {/* App-like screens keep the nav bar but fill the viewport themselves. */}
      <Route element={<AppLayout fullBleed />}>
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
