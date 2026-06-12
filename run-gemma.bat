@echo off
setlocal
cd /d "%~dp0"
set "AGENT_DIR=%CD%\gemma-agent"
set "WORKSPACE=%~1"
set "PROVIDER=%~2"
if defined PROVIDER (
    "%AGENT_DIR%\node_modules\.bin\tsx.cmd" "%AGENT_DIR%\src\index.ts" -w "%WORKSPACE%" --provider=%PROVIDER%
) else (
    "%AGENT_DIR%\node_modules\.bin\tsx.cmd" "%AGENT_DIR%\src\index.ts" -w "%WORKSPACE%"
)
