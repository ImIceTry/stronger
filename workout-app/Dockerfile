FROM python:3.13-alpine

RUN adduser -D -u 10001 app && mkdir /data && chown app /data
WORKDIR /app
COPY *.py ./

ENV WORKOUT_APP_HOST=0.0.0.0 \
    WORKOUT_APP_PORT=8092 \
    WORKOUT_DB_PATH=/data/workout.db \
    PYTHONUNBUFFERED=1

USER app
VOLUME /data
EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8092/api/health || exit 1

CMD ["python", "server.py"]
