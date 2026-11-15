# Запуск и публикация SpaceMap

В этой версии один корень проекта: package.json, Dockerfile, backend и dist лежат рядом. Загружайте содержимое этой папки в корень репозитория. Не создавайте дополнительную вложенность spacemap/spacemap.

## Быстрый запуск на Windows

Готовая сборка сайта уже находится в dist. Node.js для запуска не нужен.

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m backend.run
```

Откройте http://127.0.0.1:8000. Для Gemini создайте .env по образцу .env.example, добавьте свой ключ и перезапустите Python. Карту можно открыть без ключа Gemini.

## Хостинг с Docker

Используйте Web Service с Docker, а не Static Site: проект содержит Python API.
Корневая папка сервиса — папка с Dockerfile. Если файлы находятся в корне репозитория, Root Directory оставьте пустым.
Dockerfile: ./Dockerfile. Контекст сборки: корень проекта.
Docker сам собирает frontend и запускает Python. Стартовую команду переопределять не нужно.
Health check: /healthz.
В настройках окружения добавьте GEMINI_API_KEY и GEMINI_MODEL=gemini-3.8-flash.
render.yaml подготовлен для файлов в корне репозитория.

## Хостинг без Docker

Если платформа поддерживает Python-сервер, установите requirements.txt и запустите:

```bash
python -m backend.run
```

Сервер использует PORT из окружения и отдаёт готовую папку dist. Обычный статический хостинг может показать интерфейс из dist, но не запустит API погоды, маршрутов и Gemini. Для полного проекта необходим Python backend.

## После изменений frontend

```bash
npm ci
npm run build
```

Публикуйте dist целиком из одной сборки. Исходный index.html подключает /main.js; его не нужно копировать поверх dist/index.html. Не открывайте исходный index.html как отдельную статическую страницу.

После публикации обновите браузер сочетанием Ctrl+F5. При ошибке проверьте запросы /assets/ в Network и настройки корневой папки хостинга.

## Netlify + Render (сайт на netlify.app)

Netlify показывает только интерфейс. Маршруты, навигатор, 3D-рельеф и погоду считает Python-сервер на Render.
`netlify.toml` пересылает запросы `/api/*` на Render — поэтому оба сервиса должны работать:

1. Render: Web Service (Docker) из этого репозитория — адрес вида `https://spacemap-mars.onrender.com`.
2. Если адрес на Render другой — поправьте его в двух местах в `netlify.toml`.
3. Пересылку делают и `netlify.toml`, и файл `public/_redirects` (попадает в `dist`), поэтому работает и при загрузке папки `dist` перетаскиванием.
4. Проверка: `https://ваш-сайт.netlify.app/healthz` → `{"status":"ok"...}`. Если 404 — Render не запущен или адрес неверный.

## Приложение для Windows (MarsMap.exe)

Подробно — в DESKTOP.md. Коротко: после `git push` GitHub сам собирает `MarsMap.exe`
(вкладка Actions → Windows app → скачать MarsMap-windows: внутри установщик MarsMap-Setup.exe и MarsMap.exe). Либо на Windows запустите `desktop\build_windows.bat`.
