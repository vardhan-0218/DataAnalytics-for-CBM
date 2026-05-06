@echo off
echo ========================================
echo Starting Motor Wear Simulator (Streamlit)
echo ========================================
echo.

REM Use virtual environment if it exists, otherwise fall back to system Python
if exist "venv\Scripts\activate.bat" (
    echo Activating virtual environment...
    call venv\Scripts\activate.bat
    echo Installing/updating dependencies...
    pip install -r requirements.txt --quiet
) else (
    echo No venv found - using system Python.
    echo Installing/updating dependencies into system Python...
    pip install -r requirements.txt --quiet
)

echo.
echo ========================================
echo Make sure FastAPI backend is running on
echo http://localhost:8000  (run start_server.bat)
echo.
echo Starting Streamlit app on http://localhost:8501
echo Press CTRL+C to stop
echo ========================================
echo.

streamlit run app.py
