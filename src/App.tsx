import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import PocetniEkran from './PocetniEkran';
import AdminPanel from './Administrator/AdminPanel';
import SifarniciHub from './Sifarnici/SifarniciHub';
import RadoviDashboard from './Radovi/RadoviDashboard';
import BrziUnosRada from './Radovi/BrziUnosRada';
import MasineZaduzenje from './Masine/MasineZaduzenje';
import AuditLogDashboard from './Administrator/AuditLogDashboard';
import NeuskladjenostiMasina from './Masine/NeuskladjenostiMasina';
import RadniNaloziDashboard from './Nalozi/RadniNaloziDashboard';
import GorivoDashboard from './Gorivo/GorivoDashboard';
import RadionicaKvarovi from './Masine/RadionicaKvarovi';
import PutarineDashboard from './Masine/PutarineDashboard';
import FertilizerDashboard from './Djubrivo/FertilizerDashboard';
import SeasonalWorkersDashboard from './Sezonci/SeasonalWorkersDashboard';
import OnionDashboard from './Luk/OnionDashboard';

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PocetniEkran />} />
          <Route path="/admin" element={<AdminPanel />} />
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
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
