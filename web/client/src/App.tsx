import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useMatch, useLocation } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage.js';
import { PlanningPage } from './pages/PlanningPage.js';
import { SprintPage } from './pages/SprintPage.js';
import { ReviewPage } from './pages/ReviewPage.js';
import type { App as AppType } from '@shared/types.js';

function AppBreadcrumb() {
  const match = useMatch('/sprint/:id');
  const planMatch = useMatch('/sprint/:id/planning');
  const reviewMatch = useMatch('/sprint/:id/review');
  const sprintId = match?.params.id || planMatch?.params.id || reviewMatch?.params.id;
  const [appName, setAppName] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    if (!sprintId) {
      setAppName(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [appsRes, sprintRes] = await Promise.all([
          fetch('/api/apps'),
          fetch(`/api/sprints/${sprintId}`),
        ]);
        if (cancelled) return;
        if (!appsRes.ok || !sprintRes.ok) return;
        const apps: AppType[] = await appsRes.json();
        const sprint = await sprintRes.json();
        if (cancelled || !sprint.targetDir) return;

        // Find best matching app (longest rootFolder prefix match)
        let best: AppType | null = null;
        for (const app of apps) {
          if (sprint.targetDir.startsWith(app.rootFolder)) {
            if (!best || app.rootFolder.length > best.rootFolder.length) {
              best = app;
            }
          }
        }
        setAppName(best?.name || null);
      } catch {
        // ignore fetch errors
      }
    })();

    return () => { cancelled = true; };
  }, [sprintId, location.pathname]);

  if (!appName) return null;
  return (
    <>
      <span className="text-gray-600">/</span>
      <span className="text-sm text-gray-300">{appName}</span>
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <header className="border-b border-gray-800 px-6 py-3 flex items-center gap-4">
          <a href="/" className="text-lg font-bold text-white hover:text-blue-400 transition">
            Dev Team
          </a>
          <span className="text-xs text-gray-500">v2</span>
          <AppBreadcrumb />
        </header>
        <main className="p-6">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/sprint/:id/planning" element={<PlanningPage />} />
            <Route path="/sprint/:id" element={<SprintPage />} />
            <Route path="/sprint/:id/review" element={<ReviewPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
