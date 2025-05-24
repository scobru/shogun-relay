@echo off
setlocal

rem Define paths
set "SCRIPT_DIR=%~dp0"
set "RADATA_PATH=%SCRIPT_DIR%\..\radata"
set "OUTPUT_PATH=%SCRIPT_DIR%\..\merkle-root.json"

echo === Merkle Root Calculator ===
echo This script will calculate the Merkle root from your radata directory
echo and save it to a JSON file to speed up relay startup.
echo.
echo Using radata path: %RADATA_PATH%
echo Output will be saved to: %OUTPUT_PATH%
echo.

rem Run the Node.js script
node "%SCRIPT_DIR%\calculate-merkle-root.js" "%RADATA_PATH%" "%OUTPUT_PATH%"

rem Check if the script succeeded
if %ERRORLEVEL% equ 0 (
  echo.
  echo ✅ Merkle root updated successfully!
  echo The relay will now use this pre-calculated root on startup.
  echo Remember to run this script again if you add new users to your relay.
) else (
  echo.
  echo ❌ Failed to update Merkle root. Check the logs above for errors.
)

pause 