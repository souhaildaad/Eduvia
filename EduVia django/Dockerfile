FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY manage.py ./
COPY EduVia/ ./EduVia/
COPY api/ ./api/
COPY chatbot_train/ ./chatbot_train/
COPY mongo_migrations/ ./mongo_migrations/
COPY uploads/ /app/seed_uploads/
EXPOSE 3000
CMD ["sh", "-c", "mkdir -p ${MEDIA_ROOT:-/app/uploads} && cp -an /app/seed_uploads/. ${MEDIA_ROOT:-/app/uploads}/ 2>/dev/null || true; python manage.py migrate --noinput && gunicorn EduVia.wsgi:application --bind 0.0.0.0:${PORT:-3000} --workers 3"]
