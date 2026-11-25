import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Nav } from './components/Nav';
import { SyncStatus } from './components/SyncStatus';
import { Today } from './pages/Today';
import { Workouts } from './pages/Workouts';
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

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell>
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/sleep" element={<Placeholder title="Sleep" />} />
            <Route path="/heart" element={<Placeholder title="Heart" />} />
            <Route path="/activity" element={<Placeholder title="Activity" />} />
            <Route path="/workouts" element={<Workouts />} />
            <Route path="/workouts/:id" element={<WorkoutDetail />} />
            <Route path="/trends" element={<Placeholder title="Trends" />} />
            <Route path="/settings" element={<Placeholder title="Settings" />} />
            <Route path="*" element={<Placeholder title="Not found" />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
