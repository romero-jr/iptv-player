# IPTV Player — macOS & Windows

A native IPTV player built with Electron.

---

## Requirements
- **Node.js 18+** → https://nodejs.org

---

## Run / Build

### Dev mode
```bash
cd iptv-player
./build.sh
```

### Build for macOS
```bash
./build.sh mac
```
Produces `dist/IPTV Player.dmg` — drag the `.app` to `/Applications`.

### Build for Windows
Run this **on a Windows machine**:
```bash
./build.sh win
```
Produces `dist/IPTV Player Setup.exe` (installer) and a portable `.exe`.

On Windows, double-click `build.sh` won't work — open a terminal and run:
```
npm install
npm run build:win
```

### Build for both platforms at once (from macOS, needs Wine for Windows cross-compile)
```bash
./build.sh all
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` / `K` | Play / Pause |
| `F` | Toggle fullscreen |
| `M` | Mute |
| `↑` / `↓` | Volume up/down |
| `←` / `→` | Prev / next channel |
| `⌘B` / `Ctrl+B` | Toggle sidebar |
| `Esc` | Exit fullscreen |

---

## Data locations
- **macOS:** `~/Library/Application Support/iptv-player/`
- **Windows:** `%APPDATA%\iptv-player\`
