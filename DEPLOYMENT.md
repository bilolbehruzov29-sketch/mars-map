## Netlify frontend

`netlify.toml` configures Vite to build the frontend and publish `dist/`.
All application styles load through `src/styles.css` from `index.html`;
`main.js` imports the JavaScript modules, and the 3D terrain module loads on demand.
Opening the source HTML directly cannot resolve the npm dependencies; use the deployed Vite output.

Netlify serves the frontend only; the Python API runs on Render (Docker, see below).
`netlify.toml` forwards `/api/*` and `/healthz` to the Render service, so expedition planning,
the Navigator, 3D terrain, panorama metadata, weather and S.A.M work on the netlify.app address.
If the Render service URL differs from `https://spacemap-mars.onrender.com`, change both
redirects in `netlify.toml`. The server accepts requests from `*.netlify.app` automatically;
for a custom domain set `ALLOWED_ORIGINS=https://your-domain` on Render.
Check: `https://<site>.netlify.app/healthz` must return `{"status":"ok"...}`.

# Python-only server startup

The release contains a fresh `dist/` build. Node/Vite are not used to run the server.

## Windows PowerShell

Run these commands inside `spacemap`:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m backend.run
```

Open **http://127.0.0.1:8000**. Do not run `npx vite` or open index.html using file://. The Python process serves both the built website and `/api` endpoints. Keep that terminal running. Set GEMINI_API_KEY in `.env` for S.A.M; NASA features work without it.

## Linux / macOS

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
.venv/bin/python -m backend.run
```

## Rebuilding the frontend (only after source changes)

```sh
npm ci
npm run build
```

Then start Python as above. Vite is a build tool only. There is no JS server launcher, Vite proxy or Node runtime backend.

## Hosting

`docker compose up --build -d` serves the project on port 8000. `Dockerfile` builds JavaScript in its build stage; only Python runs in the final container. `render.yaml` (in the repository root, `rootDir: spacemap`, free plan) defines the Docker host configuration. Health endpoint: `/healthz`. Behind a reverse proxy set `FORWARDED_ALLOW_IPS=*` (already in `render.yaml`) so per-IP rate limits see real client addresses instead of the proxy's. Store Gemini credentials in server environment variables. Docker was not available for a local container build.
