
# Industrial Instrument Panel

Industrial Instrument Panel is a full-stack monitoring dashboard for motor simulation data. It combines:

- A React + Vite frontend for live visualization and operator controls
- A FastAPI backend that simulates motor behavior and EWMA-based alert states

## Tech Stack

- Frontend: React 18, TypeScript, Vite, MUI, Chart.js
- Backend: Python, FastAPI, Uvicorn, NumPy

## Repository Structure

- src: Frontend application source
- backend: Python API and simulation logic
- index.html: Vite entry HTML
- verify_refactoring.py: Utility script for local verification

## Prerequisites

- Node.js 18+
- npm 9+
- Python 3.10+

## Quick Start

### 1) Install frontend dependencies

From project root:

```bash
npm install
```

### 2) Install backend dependencies

From project root:

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/Mac
# source venv/bin/activate

pip install -r requirements.txt
```

### 3) Run backend API

From backend folder:

```bash
python -m uvicorn api_server:app --reload --port 8000
```

API base URL: http://localhost:8000  
Swagger docs: http://localhost:8000/docs

### 4) Run frontend app

From project root in a separate terminal:

```bash
npm run dev
```

Vite dev URL is typically: http://localhost:5173

## Main API Endpoints

- POST /api/start: Reset simulation and alert state
- GET /api/step: Advance one simulation step and return telemetry + alerts
- POST /api/emergency-stop: Force safe wear rate reset
- POST /api/interrupt?rate=: Update wear rate
- POST /api/set-motor-current?value=: Update baseline motor current
- POST /api/set-k-noise?value=: Update noise sensitivity
- GET /api/history?limit=: Read recent simulation history
- GET /api/events: Read interrupt event log
- GET /api/ewma-data: Get EWMA/slope/variance metrics
- GET /api/alerts: Get active alerts and alert history
- POST /api/alert-config: Update EWMA and alert thresholds
- GET /api/system-status: Integration and component status snapshot

## Notes

- Frontend API integration is implemented in src/services/api.ts.
- CORS is configured in backend/api_server.py for local frontend ports.
- Additional backend details are available in backend/README.md.
  