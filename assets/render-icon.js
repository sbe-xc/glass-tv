// Renders assets/icon.html (a <canvas>) to assets/icon.png with transparency. Run: npx electron assets/render-icon.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false });
  await win.loadFile(path.join(__dirname, 'icon.html'));
  const dataUrl = await win.webContents.executeJavaScript(`document.getElementById('c').toDataURL('image/png')`);
  fs.writeFileSync(path.join(__dirname, 'icon.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote icon.png');
  app.quit();
});
