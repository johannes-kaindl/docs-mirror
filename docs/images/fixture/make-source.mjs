// Erzeugt die Beispiel-Quelle für die README-Bilder: fünf erfundene Repositories mit je einem `docs`-Ordner.
// Aufruf: node make-source.mjs <zielordner> [zustand]   (zustand: "start" oder "spaeter")
// "spaeter" ändert eine Datei, löscht eine und fügt eine neue hinzu: daraus entsteht der zweite Plan.
import { mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";

const [, , ziel, zustand = "start"] = process.argv;
if (!ziel) throw new Error("Aufruf: node make-source.mjs <zielordner> [start|spaeter]");

const REPOS = {
  "acme-api/docs/index.md": "# Acme API\n\nThe public REST API of Acme. Start with the [authentication guide](guides/authentication.md).\n\n## Contents\n\n- Authentication\n- Rate limits\n- Error codes\n",
  "acme-api/docs/guides/authentication.md": "# Authentication\n\nEvery request carries a bearer token. Tokens expire after 24 hours.\n\n```http\nGET /v1/orders\nAuthorization: Bearer <token>\n```\n",
  "acme-api/docs/guides/rate-limits.md": "# Rate limits\n\nThe API allows 600 requests per minute per token. Burst traffic is smoothed over ten seconds.\n",
  "acme-api/docs/reference/errors.md": "# Error codes\n\n| Code | Meaning |\n|---|---|\n| 400 | The request body is not valid. |\n| 401 | The token is missing or expired. |\n| 429 | Too many requests. |\n",
  "acme-web/docs/index.md": "# Acme Web\n\nThe customer portal. Single-page app, built with a component library and a small state store.\n",
  "acme-web/docs/architecture.md": "# Architecture\n\nRoutes load their data through one client module. Components never call the API directly.\n",
  "acme-web/docs/release-checklist.md": "# Release checklist\n\n1. Run the end-to-end suite.\n2. Check the bundle size budget.\n3. Tag and publish.\n",
  "acme-mobile/docs/index.md": "# Acme Mobile\n\nThe companion app for iOS and Android.\n",
  "acme-mobile/docs/offline-mode.md": "# Offline mode\n\nOrders are queued locally and sent when the connection returns. Conflicts resolve in favor of the server.\n",
  "acme-infra/docs/runbook.md": "# Runbook\n\nHow to roll back a deployment, rotate secrets and restore the database from a snapshot.\n",
  "acme-infra/docs/network.md": "# Network layout\n\nTwo private subnets, one public load balancer, one bastion host.\n",
  "acme-billing/docs/index.md": "# Acme Billing\n\nInvoices, payment retries and tax rules.\n",
  "acme-billing/docs/tax-rules.md": "# Tax rules\n\nThe tax rate is chosen by the billing country of the customer.\n",
};

function schreibe(rel, text, i) {
  const voll = join(ziel, rel);
  mkdirSync(dirname(voll), { recursive: true });
  writeFileSync(voll, text);
  const t = new Date(1730000000000 + i * 61000);
  utimesSync(voll, t, t);
}

rmSync(ziel, { recursive: true, force: true });
mkdirSync(ziel, { recursive: true });
Object.entries(REPOS).forEach(([rel, text], i) => { schreibe(rel, text, i); });
// Was nicht gespiegelt wird: Quelltext neben den Docs (kein docs-Ordner) und ein Ordner, den die Muster ausschließen.
schreibe("acme-api/src/server.ts", "export const port = 8080;\n", 100);
schreibe("acme-web/node_modules/lib/docs/readme.md", "# Third party\n\nNever mirrored.\n", 101);

if (zustand === "spaeter") {
  schreibe("acme-api/docs/guides/rate-limits.md", REPOS["acme-api/docs/guides/rate-limits.md"] + "\nSince March the limit for the orders endpoint is 1,200 requests per minute.\n", 200);
  rmSync(join(ziel, "acme-billing/docs/tax-rules.md"));
  schreibe("acme-infra/docs/disaster-recovery.md", "# Disaster recovery\n\nThe database is restored from the latest snapshot within one hour.\n", 201);
  schreibe("acme-mobile/docs/push-notifications.md", "# Push notifications\n\nDevices register a token at launch. The server sends one notification per order status change.\n", 202);
}
console.log(`Quelle "${zustand}" gebaut: ${ziel}`);
