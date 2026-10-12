# Multi-stage build: the React client and the ASP.NET Core API are built separately,
# then the client's static files are served by the API from a small runtime image.
#
#   docker build -f AP-Master.Server/Dockerfile -t telegroup-chatbot .
#   docker run -p 8080:8080 -v telegroup-data:/app/data -e AI__ApiKey=... telegroup-chatbot
#
# Without AI__ApiKey the placeholder AI provider is used, so the image still runs end to end.

# ---- runtime base -------------------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app
EXPOSE 8080
ENV ASPNETCORE_HTTP_PORTS=8080 \
    ConnectionStrings__DefaultConnection="Data Source=/app/data/telegroup.db"
# The SQLite database lives on a volume the non-root app user can write to.
RUN mkdir -p /app/data && chown "$APP_UID" /app/data
VOLUME /app/data
USER $APP_UID

# ---- SDK with Node, for the client build (vite.config.ts calls `dotnet dev-certs`) ---------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS with-node
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# ---- client ---------------------------------------------------------------------------------
FROM with-node AS client
WORKDIR /src/ap-master.client
COPY ["ap-master.client/package.json", "ap-master.client/package-lock.json", "./"]
RUN npm ci
COPY ap-master.client/ ./
RUN npm run build

# ---- server ---------------------------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG BUILD_CONFIGURATION=Release
WORKDIR /src
COPY ["AP-Master.Server/AP-Master.Server.csproj", "AP-Master.Server/"]
# The client is built in its own stage above, so drop the reference that makes MSBuild build it again.
RUN dotnet remove "AP-Master.Server/AP-Master.Server.csproj" reference "../ap-master.client/ap-master.client.esproj" \
    && dotnet restore "./AP-Master.Server/AP-Master.Server.csproj"
COPY AP-Master.Server/ AP-Master.Server/
RUN dotnet remove "AP-Master.Server/AP-Master.Server.csproj" reference "../ap-master.client/ap-master.client.esproj"
# Put the built client in wwwroot before publishing, so it is part of the static asset manifest.
COPY --from=client /src/ap-master.client/dist/ AP-Master.Server/wwwroot/
WORKDIR "/src/AP-Master.Server"

FROM build AS publish
ARG BUILD_CONFIGURATION=Release
RUN dotnet publish "./AP-Master.Server.csproj" -c $BUILD_CONFIGURATION -o /app/publish /p:UseAppHost=false \
    # Files keep their host permissions; make sure the non-root app user can read everything.
    && chmod -R a+rX /app/publish

# ---- final ----------------------------------------------------------------------------------
FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "AP-Master.Server.dll"]
