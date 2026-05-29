# Deploy setup — manual steps only the user can do

> ✅ **DONE 2026-05-29 — `pyr3.app` is live.** Custom domain set (CNAME +
> Namecheap DNS), Let's Encrypt cert issued, **Enforce HTTPS on**, site
> serving at `https://pyr3.app/` with `github.io/pyr3/` 301-redirecting to
> it. The steps below are kept as the reference for how it was set up / how
> to redo it.

Everything else (chunk build, bake-at-deploy, routing, tests) is automated.
These are the steps that need a human with access to the domain registrar
and the GitHub repo settings. Do them when Phase 3 (deploy) is reached —
the build/test phases (1 & 2) don't need any of this.

Canonical spec:
`../../electric-sheep-fold/docs/superpowers/specs/2026-05-28-corpus-share-url-and-chunk-delivery-design.md`

---

## 1. Enable GitHub Pages on the pyr3 repo (Settings → Pages)

- **Source:** **GitHub Actions** (not "Deploy from a branch"). The deploy
  workflow (`.github/workflows/deploy.yml`, added in Task 3.2) builds the
  site, bakes in the corpus chunks, and publishes it.
- Leave the custom domain blank until step 3.

## 2. DNS for `pyr3.app` (at your domain registrar)

`pyr3.app` is an **apex/root** domain, so it needs **A + AAAA** records
pointing at GitHub Pages (a `CNAME` is not allowed on an apex). Add all
eight:

```text
Type   Name (host)   Value
─────  ───────────   ─────────────────────────
A      @             185.199.108.153
A      @             185.199.109.153
A      @             185.199.110.153
A      @             185.199.111.153
AAAA   @             2606:50c0:8000::153
AAAA   @             2606:50c0:8001::153
AAAA   @             2606:50c0:8002::153
AAAA   @             2606:50c0:8003::153
```

Optional `www` redirect (recommended):

```text
Type   Name   Value
─────  ────   ──────────────────────
CNAME  www    <your-github-username>.github.io.
```

> If your registrar supports `ALIAS`/`ANAME` flattening at the apex, a
> single `ALIAS @ → <username>.github.io` also works — but the A/AAAA set
> above is the universally-supported path GitHub documents.
>
> These are GitHub's published Pages IPs (current as of this writing). If a
> later GitHub doc lists different addresses, prefer GitHub's doc:
> https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site

## 3. Set the custom domain in GitHub (Settings → Pages → Custom domain)

- Enter `pyr3.app`, Save. GitHub writes/verifies a `CNAME` file in the
  deploy (we also ship `public/CNAME` so the Action keeps it).
- Wait for the DNS check to go green (can take minutes to a few hours for
  propagation).
- Tick **Enforce HTTPS** once the certificate is issued.

## 4. Verify

- `https://pyr3.app/` loads the renderer over HTTPS.
- `https://pyr3.app/v1/gen/247/id/<known-id>` loads that flame.
- (Optional) `dig pyr3.app +short` shows the four A records above.

---

That's the entire manual surface. After this, the recurring loop is just:
`sheep-fold release-build` (in electric-sheep-fold) → push the Release →
re-run the pyr3 deploy (it re-bakes the latest chunks). No DNS or Pages
re-config ever needed again.
