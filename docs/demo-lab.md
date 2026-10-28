# Demo lab

`lab/` is a small fake bank that produces real RUM, traces and errors in your Dynatrace environment, so you can try the
app without touching a production application. It is also how the app is proven: the load generator follows known
proportions and writes them to a ground-truth file that the graph has to reproduce.

## What runs

| Part | What it is |
|---|---|
| `demo-app` (port 8087) | "Banco Demo", retail web channel (SPA): login, statement, Pix, cards, account opening |
| `demo-empresas` (port 8089) | "Banco Demo Empresas", business channel: login by CNPJ, dashboard, batch Pix |
| `demo-portal` (port 8091) | business channel built as micro-frontends: each module change reloads the whole page |
| `gateway`, `ingress` | nginx API gateway (DMZ) and internal ingress, the only way into the APIs |
| `api`, `mobile-api` | BFFs (Node/Express) for the web and for a mobile app |
| `identidade`, `contas`, `pagamentos`, `ofertas` | domain services (Python/Flask and Node) with their own Postgres or Redis |
| `loadgen`, `loadgen-empresas`, `loadgen-portal` | Playwright journeys, one new browser session per journey |

Some steps fail on purpose (HTTP 500 on Pix, a JavaScript error on password recovery, slow offers in some regions),
so the Overview has something to show.

## Run it

1. **Credentials.** Copy `lab/.env.exemplo` to `lab/.env` and set `DT_TENANT_URL` (the `.live.dynatrace.com`
   address) and `DT_PAAS_TOKEN` (an access token with "PaaS integration - Installer download"). The images then get
   the OneAgent in application-only mode: nginx injects the RUM tag and the services send traces. Without them the
   images build with no instrumentation.
   The token is passed as a Docker build argument, so it stays in the image layers: use a token created only for
   this lab, with that single scope, and do not push the images to a registry.

2. **Web applications in Dynatrace.** Create one web application per channel (for example "Banco Demo | PF",
   "Banco Demo | PJ" and "Banco Demo Portal PJ") with detection rules for the hosts the browsers use
   (`demo-app`, `demo-empresas`, `demo-portal` inside Docker, `localhost` from your machine), and turn on RUM on
   Grail. Alternatively, use agentless RUM: paste each application's snippet into `RUM_TAG` and `RUM_TAG_EMPRESAS`.

3. **Start.**

   ```bash
   cd lab
   docker compose up -d --build
   ```

   The load generators start on their own (`PARALELO`, `PAUSA_MS` and `TOTAL` in `.env` set the pace). Open
   <http://localhost:8087> to click around yourself.

4. **Use the app.** Install Digital Experience Flow, open Configuration, select the demo applications, apply and create
   the workflow. Within 10 minutes the Overview and the Flow show the demo traffic.

5. **Stop.** `docker compose down` (add `-v` to drop the databases).

## Check against the ground truth

Each journey the load generator runs is counted in `lab/loadgen/out/gabarito*.json` (edges "from page -> to page").
Compare those proportions with the percentages on the Flow arrows, for the same period: they should match, apart from
the few minutes RUM takes to ingest.

## Resources

Around 20 containers. Give Docker at least 6 GB of memory. The Playwright load generators are the heaviest part; lower
`PARALELO` or stop them (`docker compose stop loadgen loadgen-empresas loadgen-portal`) when you only need the data
that is already there.

The `tunel-mobile` service (a public Cloudflare quick tunnel to the gateway, for a mobile test app) only starts with
`docker compose --profile mobile up`.
