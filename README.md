# Based on the Neutralinojs + Vite + React + Typescript template, whose setup can be found further below.

Installing neutralinojs and following steps 7 and 8 of the Manual Setup is required for this project to work.
The release binaries and resources can be prepared using neutralino's `neu build --release` cli command.

# Neutralinojs + Vite + React + Typescript
A simple [React](https://react.dev/) template for building [Neutralinojs](https://neutralino.js.org/) apps with [Vite](https://vitejs.dev/) as bundler and [Typescript](https://www.typescriptlang.org/)

## How to set up
### Prerequisites
All prerequisites of Neutralino, Vite, React and Typescript apply. You should have Neutralinojs CLI installed.
### Setup with Neutralino CLI
Create a new Neutralinojs project with this template with the following command:
1. `neu create myapp --template Cloudwerk/neutralinojs-vite-react-ts`
2. `cd myapp`
3. Create a `.env` file with the content `VITE_GLOBAL_URL=http://localhost:3000/`
### Manual Setup (with Neutralino CLI)
1. Clone this repository
2. Adjust the `modes.window.title` and `cli.binaryName` to your desired Application Name inside the `neutralino.config.json` file
3. Open a Terminal inside the repos root
4. run `neu update`
5. run `cd vite-src`
6. Adjust the `name` property to your desired Application Name inside the `package.json` file
7. Create a `.env` file with the content `VITE_GLOBAL_URL=http://localhost:3000/`
8. run `npm install`

## Known Issues
None :)

## How to develop

Start the React development server and Neutralinojs app:

```bash
neu run
```

### Serial input Python extension

The Neutralino extension under `extensions/serial-input-python/` streams
serial frames into the dashboard:

```bash
cd extensions/serial-input-python
python -m venv .venv && source .venv/bin/activate
pip install -e .
# Run standalone for quick checks (Neutralino will spawn it automatically during neu run/build)
python main.py
```

To load the extension while developing the app, ensure `neu run` is executed
from the repository root so `neutralino.config.json` can find the Python
handler (`python3 --py /extensions/serial-input-python/main.py`).

The extension accepts dispatch commands like `start`, `stop`, `configure`,
`health`, and `read` via `Neutralino.extensions.dispatch("serial-input-python", ...)`.

### Testing without hardware

A small mock generator is available for loopback testing:

```bash
cd extensions/serial-input-python
python mock_serial_generator.py --port loop:// --id demo --interval 0.5
```

Point the UI at the same serial URL/port (default baud `57600`) and watch
values stream into the widget board.

## How to bundle the app

Trigger a new React build and create the application bundle with the following command:
```bash
neu build
```

## License

[MIT](LICENSE)
