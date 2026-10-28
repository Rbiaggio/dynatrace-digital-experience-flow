# Web Vitals Apdex (optional)

The Overview's **Experience** card and the place colors in the maps read a score per web page load:

- the field `apdex_score` on the user.events page summaries (1 = good, 0.5 = needs improvement, 0 = poor);
- the metric `custom.rum.web_vitals.apdex_score`, with the dimensions `frontend.name`, `view.name`, `browser.name` and
  `os.name` (querying a metric is free).

Dynatrace does not compute this score out of the box. If your environment has neither, the card says so and the rest of
the app works normally. [apdex-pipeline.json](apdex-pipeline.json) is a ready user.events pipeline that computes it.

## The score

For each page load with a page summary, every Core Web Vital it has gets a grade from Google's public thresholds, and
`apdex_score` is the average of the grades:

| Vital | Good (1) | Needs improvement (0.5) | Poor (0) |
|---|---|---|---|
| LCP, largest contentful paint | up to 2.5 s | up to 4 s | above 4 s |
| INP, interaction to next paint | up to 200 ms | up to 500 ms | above 500 ms |
| CLS, cumulative layout shift | up to 0.1 | up to 0.25 | above 0.25 |

Durations in user.events are in nanoseconds, so 2.5 s is `2500000000` in the processor.

## Set it up

1. **Create the pipeline** (OpenPipeline > User events > Pipelines), from the JSON, with the Settings API:

   ```bash
   curl -X POST "https://<your-environment-id>.apps.dynatrace.com/platform/classic/environment-api/v2/settings/objects" \
     -H "Authorization: Bearer <platform token with settings:objects:write>" -H "Content-Type: application/json" \
     -d "[{\"schemaId\":\"builtin:openpipeline.user.events.pipelines\",\"scope\":\"environment\",\"value\":$(cat docs/apdex-pipeline.json)}]"
   ```

   Add `?validateOnly=true` to the URL first to check it without writing anything.

2. **Route the web events to it** (OpenPipeline > User events > Dynamic routing), for example with the matcher
   `frontend.type == "web"`. Each event goes to one pipeline only, so this pipeline must receive all the web events of
   the applications, not only the page summaries.

3. **Apply the app configuration again.** The Configuration screen finds a user.events pipeline that already receives
   the applications and puts the app's two rules inside it (integrated mode), after your processors, so the copy carries
   `apdex_score`. Mobile applications are added to that route by the app. Nothing that already exists in the pipeline
   changes: the app refuses to apply if it would.

Best order: create this pipeline and its route before applying the app configuration for the first time. If the app
already has its own pipeline, the Configuration screen warns that the tenant routes user.events to another pipeline.

## Cost

The metric writes one data point per page load that has a Web Vital (metric ingest is billed per data point). The
processor itself adds no query cost.
