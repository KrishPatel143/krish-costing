# Krish-CRM — Pouch Costing Calculator

A professional, modular desktop application built with **Electron** and **Next-like architecture** for calculating paper and flexible pouch costing.

## Features

- **Paper Pouch Calculator**: Detailed costing based on width, height, material selection, and ink coverage.
- **Flexible Pouch Calculator**: (Coming soon/Refactored) for multi-ply materials.
- **Real-time Rates**: Editable material rates (₹ / kg) stored in a local JSON database.
- **Calculation History**: Automatic tracking of recent calculations.
- **Cross-Platform**: Built for both macOS and Windows.

## Tech Stack

- **Core**: JavaScript (ES modules)
- **Runtime**: [Electron](https://www.electronjs.org/)
- **Database**: [LowDB](https://github.com/typicode/lowdb) (local JSON file)
- **UI**: Vanilla HTML/CSS with custom component architecture

## Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run in development**:
   ```bash
   npm start
   ```

3. **Build applications**:
   ```bash
   # Build for all platforms
   npm run build

   # Build for specific platform
   npm run build:mac
   npm run build:win
   ```

## Repository Structure

- `main.js`: Main process and IPC handlers.
- `preload.js`: Bridge for secure communication.
- `renderer/`: Frontend logic and UI.
  - `js/`: UI components and library functions.
  - `styles/`: CSS modules.
- `assets/`: Icons and static images.
- `dist/`: Build artifacts (executables/installers).

## License

ISC License (c) 2026 Krish Enterprises
