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
          <Route path="/masine/zaduzenje" element={<MasineZaduzenje />} />
          <Route path="/masine-kvarovi" element={<MasineZaduzenje />} />
          <Route path="/masine/neusklađenosti" element={<NeuskladjenostiMasina />} />
          <Route path="/radovi/neusklađenosti" element={<NeuskladjenostiMasina />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
