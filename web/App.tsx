import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Nav } from './components/Nav';
import { SyncStatus } from './components/SyncStatus';
import { Today } from './pages/Today';
import { Workouts } from './pages/Workouts';
import { Sleep } from './pages/Sleep';
import { Heart } from './pages/Heart';
import { Activity } from './pages/Activity';
import { Trends } from './pages/Trends';
import { Settings } from './pages/Settings';
import { Setup, type SetupData } from './pages/Setup';
import { useApi } from './api';
import { WorkoutDetail } from './pages/WorkoutDetail';
import './theme.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60000, retry: 1 } } });

function Placeholder({ title }: { title: string }) {
  return <h1 className="headline">{title}</h1>;
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="page">
        <header className="topbar">
          <Nav />
          <SyncStatus />
        </header>
        {children}
      </main>
      <footer className="disclaimer">Not a medical device. For personal insight only.</footer>
    </>
  );
}

function Home() {
  const { data } = useApi<SetupData>('/api/setup');
  if (!data) return <p className="empty">Loading…</p>;
  return data.daysOfData === 0 ? <Setup /> : <Today />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/sleep" element={<Sleep />} />
            <Route path="/heart" element={<Heart />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/workouts" element={<Workouts />} />
            <Route path="/workouts/:id" element={<WorkoutDetail />} />
            <Route path="/trends" element={<Trends />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="*" element={<Placeholder title="Not found" />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
