# Deploy

## What was done

Azure App Service `loupeapp` (Linux, Node 22, B1 plan `asp-ivan`) in `rg-ivan-dev` (East US 2), subscription `77e69dbb-cf80-4ca0-a4f0-c9adf9550c37`. URL: https://loupeapp.azurewebsites.net. The app builds via `pnpm build` into `.output/` (Nitro server). The native `better-sqlite3` binary must be swapped for the Linux x64 Node 22 prebuild before zipping. SQLite DB lives at `/home/data/agentops.db` (persistent storage), uploaded separately via Kudu VFS API.

## How to redeploy

```bash
pnpm build
# Swap native module for Linux (one-time download: https://github.com/JoshuaWise/better-sqlite3/releases/download/v12.10.0/better-sqlite3-v12.10.0-node-v127-linux-x64.tar.gz)
cp /path/to/linux/better_sqlite3.node .output/server/node_modules/better-sqlite3/build/Release/
cd .output && zip -r ../deploy.zip . -q && cd ..
az webapp deploy -g rg-ivan-dev -n loupeapp --subscription 77e69dbb-cf80-4ca0-a4f0-c9adf9550c37 --src-path deploy.zip --type zip --clean true
```

## Migrating SQLite → Postgres

When switching to Postgres, use `pgloader your.db postgresql://...` to transfer schema + data in one step. Alternatively, dump with `sqlite3 your.db .dump > dump.sql`, fix syntax differences, and import with `psql`. Keep versioned Drizzle migrations so the Postgres schema can be replayed from scratch and only data needs transferring.

## Updating the database

To update the database schema, run migrations locally into a fresh DB then upload:

```bash
TOKEN=$(az account get-access-token --resource "https://management.azure.com" --query accessToken -o tsv)
curl -X PUT "https://loupeapp.scm.azurewebsites.net/api/vfs/data/agentops.db" --data-binary @/tmp/agentops-deploy.db -H "Content-Type: application/octet-stream" -H "Authorization: Bearer $TOKEN" -H "If-Match: *"
```
