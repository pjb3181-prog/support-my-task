@echo off
setlocal
cd /d "%~dp0"
echo [Character Mixer] Starting local Python image bridge...
if exist "%~dp0pythoncore-3.14-64\python.exe" (
  "%~dp0pythoncore-3.14-64\python.exe" "%~dp0character_mixer_bridge.py"
  goto :finish
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 "%~dp0character_mixer_bridge.py"
  goto :finish
)
where python >nul 2>nul
if not errorlevel 1 (
  python "%~dp0character_mixer_bridge.py"
  goto :finish
)
echo No Python found. Use the Python environment from your working Gelbooru Downloader.
:finish
if errorlevel 1 echo [Character Mixer] Failed. Check that Python requests is installed and GoodbyeDPI (if needed) is running.
pause
