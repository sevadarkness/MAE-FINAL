@echo off
echo.
echo ========================================
echo    WhatsHybrid Backend v7.5.0
echo ========================================
echo.

REM Verificar Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js nao encontrado!
    echo         Instale em: https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js encontrado

REM Verificar arquivo .env
if not exist ".env" (
    echo.
    echo [AVISO] Arquivo .env nao encontrado!
    echo         Criando a partir de .env.example...
    copy .env.example .env
    echo.
    echo ========================================
    echo    CONFIGURACAO NECESSARIA
    echo ========================================
    echo.
    echo    Edite o arquivo .env e configure:
    echo.
    echo    1. JWT_SECRET (troque por chave segura)
    echo.
    echo    2. Pelo menos UMA chave de API de IA:
    echo       - GROQ_API_KEY (recomendado - gratuito!)
    echo       - OPENAI_API_KEY
    echo       - ANTHROPIC_API_KEY
    echo.
    echo    Obter chave Groq GRATUITA:
    echo    https://console.groq.com/keys
    echo.
    pause
    exit /b 1
)

REM Criar diretorio de dados
if not exist "data" mkdir data

REM Instalar dependencias se necessario
if not exist "node_modules" (
    echo [INFO] Instalando dependencias...
    call npm install
)

echo.
echo [INFO] Iniciando servidor...
echo.
call npm start
