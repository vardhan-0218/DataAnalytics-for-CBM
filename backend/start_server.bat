@echo off
echo ========================================
echo Starting Motor Simulation API Server
echo ========================================
echo.

REM Check if virtual environment exists
if not exist "venv\" (
    echo Virtual environment not found. Creating...
    python -m venv venv
    echo.
)

REM Activate virtual environment and start server
echo Activating virtual environment...
call venv\Scripts\activate.bat

echo.
echo Installing/updating dependencies...
pip install -r requirements.txt --quiet

echo.
echo ========================================
echo Starting server on http://localhost:8000
echo API docs: http://localhost:8000/docs
echo Press CTRL+C to stop
echo ========================================
echo.

python -m uvicorn api_server:app --reload --port 8000
