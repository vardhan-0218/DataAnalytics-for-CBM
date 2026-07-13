import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from '../pages/Dashboard';
import StreamlitDemo from '../pages/demo/StreamlitDemo';
import DigitalTwin from '../pages/DigitalTwin';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/demo" element={<StreamlitDemo />} />
        <Route path="/digital-twin" element={<DigitalTwin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}