import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import PocetniEkran from './PocetniEkran';

const AdminPanel = lazy(() => import('./Administrator/AdminPanel'));
const SifarniciHub = lazy(() => import('./Sifarnici/SifarniciHub'));
const RadoviDashboard = lazy(() => import('./Radovi/RadoviDashboard'));
const BrziUnosRada = lazy(() => import('./Radovi/BrziUnosRada'));
const MasineZaduzenje = lazy(() => import('./Masine/MasineZaduzenje'));
const AuditLogDashboard = lazy(() => import('./Administrator/AuditLogDashboard'));
const NeuskladjenostiMasina = lazy(() => import('./Masine/NeuskladjenostiMasina'));
const RadniNaloziDashboard = lazy(() => import('./Nalozi/RadniNaloziDashboard'));
const GorivoDashboard = lazy(() => import('./Gorivo/GorivoDashboard'));
const RadionicaKvarovi = lazy(() => import('./Masine/RadionicaKvarovi'));
const PutarineDashboard = lazy(() => import('./Masine/PutarineDashboard'));
const FertilizerDashboard = lazy(() => import('./Djubrivo/FertilizerDashboard'));
const SeasonalWorkersDashboard = lazy(() => import('./Sezonci/SeasonalWorkersDashboard'));
const OnionDashboard = lazy(() => import('./Luk/OnionDashboard'));
const AnalitikaDashboard = lazy(() => import('./Analitika/AnalitikaDashboard'));

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Suspense fallback={
          <div role="status" aria-live="polite" style={{ padding: '2rem', textAlign: 'center' }}>
            Učitavanje stranice…
          </div>
        }>
          <Routes>
            <Route path="/" element={<PocetniEkran />} />
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="/analitika" element={<AnalitikaDashboard />} />
            <Route path="/revizija" element={<AuditLogDashboard />} />
            <Route path="/sifarnici" element={<SifarniciHub />} />
            <Route path="/nalozi" element={<RadniNaloziDashboard />} />
            <Route path="/gorivo" element={<GorivoDashboard />} />
            <Route path="/radovi" element={<RadoviDashboard />} />
            <Route path="/radovi/novi" element={<BrziUnosRada />} />
            <Route path="/zaduzivanje-masina" element={<MasineZaduzenje />} />
            <Route path="/masine/zaduzenje" element={<Navigate to="/zaduzivanje-masina" replace />} />
            <Route path="/masine-kvarovi" element={<RadionicaKvarovi />} />
            <Route path="/masine/putarine" element={<PutarineDashboard />} />
            <Route path="/magacin-djubrivo" element={<FertilizerDashboard />} />
            <Route path="/djubrivo" element={<Navigate to="/magacin-djubrivo" replace />} />
            <Route path="/modul-luk" element={<OnionDashboard />} />
            <Route path="/luk" element={<Navigate to="/modul-luk" replace />} />
            <Route path="/sezonci" element={<SeasonalWorkersDashboard />} />
            <Route path="/sezonski-radnici" element={<Navigate to="/sezonci" replace />} />
            <Route path="/masine/neusklađenosti" element={<NeuskladjenostiMasina />} />
            <Route path="/radovi/neusklađenosti" element={<NeuskladjenostiMasina />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
