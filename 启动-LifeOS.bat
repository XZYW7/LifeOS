@echo off
rem LifeOS 一键启动：前端构建(如需) + 后端单端口 3456
cd /d "%~dp0"

if not exist "app\dist\index.html" (
  echo [LifeOS] 未检测到前端构建产物，正在构建 app/dist ...
  cd app
  call npm run build
  if errorlevel 1 (
    echo [LifeOS] 前端构建失败，请检查上方错误信息。
    pause
    exit /b 1
  )
  cd ..
) else (
  echo [LifeOS] 已存在 app/dist，跳过构建（如需更新请先运行 cd app ^&^& npm run build）
)

echo.
echo [LifeOS] 正在启动后端（单端口 3456，托管前端 + API）...
echo [LifeOS] 本机访问: http://localhost:3456
echo [LifeOS] 手机访问: 启动后查看日志中的 "LAN 访问" 地址，或请求 /api/access-info
echo.
cd server
call npm run dev
pause
