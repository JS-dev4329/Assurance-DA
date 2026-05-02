@echo off
chcp 65001 > nul
cd /d "%~dp0"
title 연결정산표 이월 자동화

echo.
echo  ╔══════════════════════════════════════╗
echo  ║      연결정산표 이월 자동화           ║
echo  ╚══════════════════════════════════════╝
echo.

:: Node.js 설치 확인
where node > nul 2>&1
if errorlevel 1 (
    echo  [오류] Node.js가 설치되어 있지 않습니다.
    echo  https://nodejs.org 에서 Node.js를 설치 후 다시 실행하세요.
    echo.
    pause
    exit /b 1
)

:: 패키지 설치 (처음 실행 또는 node_modules 없을 때)
if not exist node_modules (
    echo  [1/3] 패키지 설치 중... (처음 실행 시 수분 소요)
    call npm install
    if errorlevel 1 (
        echo  [오류] 패키지 설치에 실패했습니다.
        pause
        exit /b 1
    )
    echo  [1/3] 패키지 설치 완료
) else (
    echo  [1/3] 패키지 확인 완료
)

:: 앱 빌드 (dist 없거나 소스 변경 시)
echo  [2/3] 앱 빌드 중...
call npm run build
if errorlevel 1 (
    echo  [오류] 빌드에 실패했습니다.
    pause
    exit /b 1
)
echo  [2/3] 빌드 완료

:: Electron 실행
echo  [3/3] 앱을 실행합니다...
echo.
call npm run electron

exit /b 0
