# Backend API

This folder contains the Python backend for the Industrial Instrument Panel.

## Files

- `data_generation.py` - Core motor simulation logic (UNTOUCHED from original)
- `analysis.py` - EWMA analysis and alerting logic (UNTOUCHED from original)
- `api_server.py` - FastAPI wrapper that exposes REST endpoints
- `requirements.txt` - Python dependencies

## Setup

1. Create a virtual environment:
```bash
python -m venv venv
```

2. Activate the virtual environment:
```bash
# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

## Running the API Server

### Option 1: Using the startup script (Windows)

```bash
start_server.bat
```

### Option 2: Manual startup

```bash
# Activate virtual environment
venv\Scripts\activate

# Start server
python -m uvicorn api_server:app --reload --port 8000
```

The API will be available at `http://localhost:8000`

API documentation (Swagger UI): `http://localhost:8000/docs`

### Testing the API

Run the test script (in a separate terminal while server is running):

```bash
venv\Scripts\activate
pip install requests
python test_api.py
```

## API Endpoints

- `POST /api/start` - Reset simulation
- `GET /api/step` - Advance one step and get current state
- `POST /api/interrupt?rate=<value>` - Update wear rate
- `POST /api/set-motor-current?value=<value>` - Update motor current baseline
- `POST /api/set-k-noise?value=<value>` - Update noise sensitivity
- `POST /api/simulate` - Run simulation with all parameters (JSON body)
- `GET /api/history?limit=<n>` - Get recent simulation history
- `GET /api/events` - Get interrupt events log
- `GET /api/status` - Get current simulation status

## Notes

- `data_generation.py` and `analysis.py` are UNTOUCHED from the original implementation
- All API logic is contained in `api_server.py` which imports and wraps the existing modules
- The simulator maintains state in memory (resets on server restart)
