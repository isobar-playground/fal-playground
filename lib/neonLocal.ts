// Side-effect import for every module that calls neon(): when DATABASE_URL points
// at the local docker proxy (docker-compose.yml) instead of *.neon.tech, the Neon
// serverless driver must be told its HTTP endpoint explicitly — it otherwise
// derives https://<host>/sql from the connection string, and the local proxy
// listens on plain HTTP port 4444. No-op against a real Neon URL.
import { neonConfig } from "@neondatabase/serverless";

if (process.env.DATABASE_URL?.includes("db.localtest.me")) {
  neonConfig.fetchEndpoint = "http://db.localtest.me:4444/sql";
}
