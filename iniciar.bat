@echo off
title Imagen a 3D — Servidor Local
color 0A

rem Siempre usar la carpeta donde está este .bat (evita "no se encuentra server.js" al abrir desde otro sitio)
cd /d "%~dp0"

if not exist "server.js" (
  echo  ERROR: No se encuentra server.js en esta carpeta.
  echo  Ubicacion esperada: %CD%
  echo  Copia todo el proyecto en una carpeta y vuelve a ejecutar iniciar.bat.
  echo.
  pause & exit /b 1
)

echo.
echo  =============================================
echo   IMAGEN A 3D  ^|  Servidor Local
echo  =============================================
echo.

node --version >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Node.js no esta instalado.
  echo  Descargalo en: https://nodejs.org
  echo.
  pause & exit /b 1
)

if not exist "node_modules" (
  echo  Instalando dependencias por primera vez...
  echo  Espera un momento...
  echo.
  npm install
  if errorlevel 1 (
    echo.
    echo  ERROR al instalar. Intenta: npm install --legacy-peer-deps
    pause & exit /b 1
  )
  echo.
)

echo  Servidor iniciado.
echo.
echo  ^> Abre en tu navegador: http://localhost:3000
echo  ^> NO uses Live Server ni otro puerto.
echo  ^> Presiona Ctrl+C para detener.
echo.

node server.js
pause
