@echo off
setlocal
if not exist "%~dp0runtime\node.exe" (
  echo Portable runtime is missing. Rebuild or restore the complete offline package.
  pause
  exit /b 1
)
echo Green Pavlodar - local mock, code a66d542
echo Keep this window open. Press Ctrl+C to stop.
"%~dp0runtime\node.exe" "%~dp0server.mjs" --open
if errorlevel 1 pause
