# Build stage — produces a per-target sidecar binary that the Tauri
# build matrix can drop into src-tauri/binaries/.
FROM python:3.12-slim AS fetcher
WORKDIR /work
COPY scripts/fetch_ipatool.py /work/
RUN chmod +x /work/fetch_ipatool.py
ENTRYPOINT ["python", "/work/fetch_ipatool.py"]
