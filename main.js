const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');
const { startServer } = require('./server');

const PORT = 34521;
let mainWindow;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: '미국 주식 수익률 분석기',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0f1117',
    show: false, // 로딩 완료 후 표시
  });

  // 메뉴 제거 (깔끔한 앱 UI)
  Menu.setApplicationMenu(null);

  mainWindow.loadURL(`http://localhost:${port}`);

  // 로딩 완료 후 창 표시 (흰 화면 깜빡임 방지)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 외부 링크는 브라우저로 열기
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    const port = await startServer(PORT);
    createWindow(port);
  } catch (err) {
    dialog.showErrorBox('서버 시작 실패', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    startServer(PORT).then(createWindow);
  }
});
