# EduVia

EduVia uses Angular for its frontend and Django for its backend. All API code and backend deployment files are in `EduVia django/`; no Node backend is needed.

## Run locally

MongoDB must be running first. With Docker installed, start a local MongoDB using:

```powershell
docker compose -f EduVia-infra/docker-compose.yml up -d mongo
```

The Django settings default to `mongodb://127.0.0.1:27017` and the database `eduvia`.

```powershell
cd 'EduVia django'
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:DJANGO_DEBUG = 'true'
$env:DJANGO_SECRET_KEY = 'local-development-key-change-me'
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 0.0.0.0:3000
```

Run Angular in a second terminal:

```powershell
cd EduVia-Frontend
npm install
npm start
```

Angular's development proxy sends `/api`, `/auth`, `/notifications`, and `/ai` requests to Django on port 3000. The production Nginx config proxies these paths to the Django service.

## Backend configuration

- `DJANGO_SECRET_KEY`: set a private, stable value before deployment.
- `DJANGO_ALLOWED_HOSTS`: comma-separated hostnames.
- `MONGODB_URI`: MongoDB connection string; defaults to `mongodb://127.0.0.1:27017`.
- `MONGODB_NAME`: MongoDB database name; defaults to `eduvia`.
- `FRONTEND_URL`: allowed browser origin and password-reset link base.
- `BACKEND_URL`: public Django URL used in email confirmation links; defaults to `http://localhost:3000`.
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `DEFAULT_FROM_EMAIL`: configure account emails. Local development prints emails to the console.
- `CHATBOT_AI_URL`: optional URL for the separate AI chat endpoint. The Django API reports unavailable when no AI server responds.

MongoDB data and uploaded files are persisted in Docker Compose volumes. For Kubernetes, provide the `eduvia-backend-secrets` secret with keys `django-secret-key` and `mongodb-uri`; set `MONGODB_NAME` in the backend deployment. Store the MongoDB URI in the cluster secret and do not commit credentials to source control.

## Django API

The API keeps Angular's existing route families and now handles authentication and accounts, profiles, student records, planner events and tasks, notifications, content CRUD and uploads, internships, clubs, forum chats, meeting records, and AI chat forwarding. JSON resources are persisted in Django's database.

Existing NestJS records can be copied from the configured MongoDB database into Django's collections with `python manage.py import_legacy_mongo`. The command is safe to repeat and keeps all original collections unchanged. The user and feature data in the current local database has already been imported. Old passwords were managed by the previous identity system and cannot be reused as Django passwords; reset each user's password with `python manage.py changepassword <email>` or configure SMTP for the password-reset flow.

Some advanced integrations still need Django implementations: quiz/flashcard generation and parsing, automated reminder emails, live meeting provider integration, and the legacy recommendation model. Existing uploaded documents/videos were moved into `EduVia django/uploads/`; Python model and chatbot artifacts are retained under `EduVia django/ai_legacy/`.
