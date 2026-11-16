# syntax=docker/dockerfile:1

# ---- Frontend (Vite SPA) ----
FROM node:24-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- .NET legacy API ----
FROM mcr.microsoft.com/dotnet/sdk:10.0-noble AS build
WORKDIR /src
COPY Directory.Build.props ./
COPY backend/DarEltahfeez.Api/DarEltahfeez.Api.csproj backend/DarEltahfeez.Api/
RUN dotnet restore backend/DarEltahfeez.Api/DarEltahfeez.Api.csproj
COPY backend/ backend/
COPY database/ database/
RUN dotnet publish backend/DarEltahfeez.Api/DarEltahfeez.Api.csproj -c Release -o /app/publish --no-restore

# ---- Runtime: .NET 10 + PostgreSQL 17 client (pg_dump/pg_restore) ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/publish ./
COPY --from=frontend /src/frontend/dist ./wwwroot/
RUN mkdir -p /var/lib/dar/backups && chown -R app:app /var/lib/dar /app

USER app
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    Database__ApplyMigrationsOnStartup=false \
    Backup__RootPath=/var/lib/dar/backups
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["dotnet", "DarEltahfeez.Api.dll"]
