import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage.js';
import { PlanningPage } from './pages/PlanningPage.js';
import { SprintPage } from './pages/SprintPage.js';
import { ReviewPage } from './pages/ReviewPage.js';

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <header className="border-b border-gray-800 px-6 py-3 flex items-center gap-4">
          <a href="/" className="text-lg font-bold text-white hover:text-blue-400 transition">
            Dev Team
          </a>
          <span className="text-xs text-gray-500">v2</span>
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
