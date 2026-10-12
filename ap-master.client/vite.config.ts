import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import type { ServerOptions } from "vite";
import plugin from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import child_process from "child_process";
import { env } from "process";

/**
 * The dev server runs on HTTPS with the ASP.NET Core development certificate, exported
 * here on first run. Only `vite` (serve) needs it, so `vite build` and Vitest run on a
 * machine without the .NET SDK (CI's client job, the Docker client stage).
 */
function devCertificate(): { key: Buffer; cert: Buffer } {
  const baseFolder =
    env.APPDATA !== undefined && env.APPDATA !== "" ? `${env.APPDATA}/ASP.NET/https` : `${env.HOME}/.aspnet/https`;

  const certificateName = "ap-master.client";
  const certFilePath = path.join(baseFolder, `${certificateName}.pem`);
  const keyFilePath = path.join(baseFolder, `${certificateName}.key`);

  if (!fs.existsSync(baseFolder)) {
    fs.mkdirSync(baseFolder, { recursive: true });
  }

  if (!fs.existsSync(certFilePath) || !fs.existsSync(keyFilePath)) {
    if (
      0 !==
      child_process.spawnSync("dotnet", ["dev-certs", "https", "--export-path", certFilePath, "--format", "Pem", "--no-password"], { stdio: "inherit" })
        .status
    ) {
      throw new Error("Could not create certificate.");
    }
  }

  return { key: fs.readFileSync(keyFilePath), cert: fs.readFileSync(certFilePath) };
}

const target = env.ASPNETCORE_HTTPS_PORT
  ? `https://localhost:${env.ASPNETCORE_HTTPS_PORT}`
  : env.ASPNETCORE_URLS
    ? env.ASPNETCORE_URLS.split(";")[0]
    : "http://localhost:5056";

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const server: ServerOptions = {
    proxy: {
      "^/api": {
        target,
        secure: false,
      },
      // SignalR: the staff dashboard's live ticket feed runs over WebSockets.
      "^/hubs": {
        target,
        secure: false,
        ws: true,
      },
    },
    port: parseInt(env.DEV_SERVER_PORT || "9879"),
  };

  if (command === "serve" && !env.VITEST) {
    server.https = devCertificate();
  }

  return {
    plugins: [plugin()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server,
  };
});
