# Run a live pilot server

How to run one long-lived Verapass server in live mode, so real check-ins are stamped on the testnet contract, for a small pilot with real guests. Two recipes: a small Linux VM with Caddy for HTTPS and a systemd unit, or a laptop with a Cloudflare quick tunnel. Both serve the web app and the API from one Node process.

Checked on 2026-10-10 against `server/config.ts`, `server/index.ts` and `scripts/pilot-preflight.mjs`. The server and preflight commands below were run locally with throwaway values; the Caddy, systemd and cloudflared steps follow those tools' own documentation and were not run on a real VM.

The hosted demo at https://verapass.vercel.app is not a pilot server: it runs mock attestation, simulated check-ins and per-instance memory. Leave it as it is.

## What live mode needs

Phones only share GPS with secure (https) pages, so the server must be reached over HTTPS. Both recipes put a proxy in front of the Node process: Caddy on the VM, `cloudflared` on the laptop.

The server reads its settings from the environment, and `server/index.ts` also loads a file named `.env` from the directory it starts in. Never paste a value into chat, a ticket, a document or a commit. This page names variables only.

| Variable | Pilot setting | Why |
|---|---|---|
| `NODE_ENV` | `production` | Turns on the startup self-check: the server refuses to start without a fixed receipt key, a fixed traveller secret and an explicit simulation setting |
| `STELLAR_SECRET` | the attestor secret key (`S...`), key name `verapass-attestor` | Signs stamp transactions. The attestor key, never the admin key (`verapass-admin`) |
| `VERAPASS_CONTRACT_ID` | `CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65` | The `verapass_stamps` v1 contract on testnet (`contracts/DEPLOYMENT.md`). With `STELLAR_SECRET` it turns on live stamping |
| `TRAVELLER_SECRET` | 64 random hex characters, generated once | Derives every guest's passport id and on-chain address. Changing it during the pilot breaks every passport |
| `RECEIPT_SIGNING_KEY` | an Ed25519 PKCS#8 PEM on one line (`\n` for newlines), generated once | Signs check-in receipts. A new key makes earlier receipts stop verifying |
| `ALLOW_SIMULATED_CHECKINS` | `false` | Only on-site check-ins count |
| `SERVE_STATIC` | `true` | The same process serves the built web app from `dist/` |
| `TRUST_PROXY` | `true` | Reads the guest's IP from `X-Forwarded-For` for the per-IP rate limits. See [TRUST_PROXY](#trust_proxy) |
| `PUBLIC_ORIGIN` | the pilot URL, `https://...` | Only used as the return address after card checkout, which is off in the pilot. Set it anyway |
| `STRIPE_SECRET_KEY` | not set | No payments in the pilot |
| `PORT` | optional, default `8787` | The port Caddy or the tunnel forwards to |
| `STELLAR_RPC_URL` | optional, default `https://soroban-testnet.stellar.org` | The Soroban RPC the attestor uses |

Optional: `RATE_LIMIT_TRAVELLER_PER_HOUR`, `RATE_LIMIT_API_PER_MINUTE`, `RATE_LIMIT_PLACE_PER_MINUTE` (defaults 30, 60, 120), and the shared-store pair `VERAPASS_REDIS_REST_URL` / `VERAPASS_REDIS_REST_TOKEN`. A single pilot server does not need the store; without it state lives in this one process (see [Logs, restarts and updates](#logs-restarts-and-updates)).

### The preflight check

`scripts/pilot-preflight.mjs` checks every setting above against what the server needs, asks the Stellar RPC for `getHealth`, and checks the Node version. It prints one line per check with `PASS`, `WARN` or `FAIL` and never prints a value. It exits with code 1 if anything failed.

```bash
node --env-file=.env scripts/pilot-preflight.mjs
```

With `--server` it also reads `/api/health` from the running server and checks that it really runs in live mode: attestation `testnet`, the same contract id as `VERAPASS_CONTRACT_ID`, simulation off, a fixed receipt key, payments off, and the state store you configured.

```bash
node --env-file=.env scripts/pilot-preflight.mjs --server https://pilot.example.org
```

A good run ends with `Preflight passed (1 warning).`. The one warning is the in-memory state store, which is expected for a single server.

## Recipe 1: small VM with Caddy and systemd

For a VM you control (any provider; 1 vCPU and 1 GB of memory is enough) running Ubuntu 24.04 or Debian 12, with a DNS name pointing at it. Below, `pilot.example.org` stands for your name.

### 1. DNS and firewall

Create an `A` record (and `AAAA` if the VM has IPv6) for `pilot.example.org` pointing at the VM. Then allow only SSH and the web ports:

```bash
sudo apt update && sudo apt install -y ufw git curl
sudo ufw default deny incoming
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```

The Node server listens on every interface. The firewall keeps port 8787 closed from outside, which matters because with `TRUST_PROXY=true` a client that reached Node directly could set its own `X-Forwarded-For`.

### 2. Node 22 and a service user

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # 22.12 or newer

sudo useradd --system --create-home --home-dir /opt/verapass --shell /usr/sbin/nologin verapass
sudo -u verapass git clone [FOUNDER: public repository URL] /opt/verapass/app
```

### 3. Install and build

```bash
cd /opt/verapass/app
sudo -u verapass npm ci
sudo -u verapass env SITE_URL=https://pilot.example.org npm run build
```

Run `npm ci` without `NODE_ENV=production` in the shell: the server runs through `tsx`, which is a dev dependency. `SITE_URL` only sets the canonical URL and link previews in the built page.

### 4. The settings file

Create `.env` in the app directory, readable only by the service user:

```bash
cd /opt/verapass/app
sudo -u verapass sh -c 'umask 077 && touch .env'
```

Generate the two fixed secrets straight into the file (nothing is printed):

```bash
sudo -u verapass node -e "const c=require('crypto'),fs=require('fs');const pem=c.generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'}).replace(/\n/g,'\\\\n');fs.appendFileSync('.env','TRAVELLER_SECRET='+c.randomBytes(32).toString('hex')+'\nRECEIPT_SIGNING_KEY='+pem+'\n',{mode:0o600})"
```

Add the attestor key. It lives in the Stellar CLI keystore of the machine that deployed the contract. Pipe it from that machine to the VM so it never shows on a screen (this needs `sudo` without a password prompt for your SSH user on the VM, which most cloud images set up for the default user):

```bash
# on the machine that deployed the contract, from the repository root
contracts/.tools/bin/stellar keys secret verapass-attestor \
  | ssh pilot.example.org 'sudo -u verapass sh -c "cd /opt/verapass/app && { printf STELLAR_SECRET=; cat; } >> .env"'
```

Add the plain settings:

```bash
sudo -u verapass tee -a /opt/verapass/app/.env > /dev/null <<'EOF'
NODE_ENV=production
VERAPASS_CONTRACT_ID=CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65
ALLOW_SIMULATED_CHECKINS=false
SERVE_STATIC=true
TRUST_PROXY=true
PUBLIC_ORIGIN=https://pilot.example.org
PORT=8787
EOF
```

Check it:

```bash
cd /opt/verapass/app
sudo -u verapass node --env-file=.env scripts/pilot-preflight.mjs
```

If you run `npm run build` again later, Vite may warn that `NODE_ENV=production` in `.env` is not supported. That warning is about the web build only and does no harm.

### 5. The systemd unit

```bash
sudo tee /etc/systemd/system/verapass.service > /dev/null <<'EOF'
[Unit]
Description=Verapass pilot server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=verapass
Group=verapass
WorkingDirectory=/opt/verapass/app
ExecStart=/opt/verapass/app/node_modules/.bin/tsx server/index.ts
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now verapass
sudo journalctl -u verapass -n 20 --no-pager
```

The server reads `.env` from its working directory, so the unit needs no `Environment=` lines. The last command should show one startup line like:

```text
[verapass] API on http://localhost:8787 - payments: demo mode, attestation: testnet contract CDIVZ...EZ65, simulated check-ins: off, state: in memory (this process only)
```

If it shows `Refusing to start in production without:` followed by a list, fix those settings and run `sudo systemctl restart verapass`.

### 6. Caddy for HTTPS

Install Caddy from its official package repository:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Replace the default site with the pilot:

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
pilot.example.org {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8787
}
EOF
sudo systemctl reload caddy
```

Caddy gets and renews the certificate on its own once DNS points at the VM and ports 80 and 443 are open. It sets `X-Forwarded-For` to the address of the client that connected to it and ignores any `X-Forwarded-For` a client sends, which is what `TRUST_PROXY=true` expects. The Caddyfile has no `log` directive on purpose: the pilot does not need an access log of guest IP addresses.

### 7. Check it from outside

```bash
curl -s https://pilot.example.org/api/health
cd /opt/verapass/app && sudo -u verapass node --env-file=.env scripts/pilot-preflight.mjs --server https://pilot.example.org
```

Then open `https://pilot.example.org` on a phone and allow location.

## Recipe 2: laptop with a Cloudflare quick tunnel

For a short test or a day when no VM is ready. A quick tunnel needs no Cloudflare account and no DNS, but its address changes every time `cloudflared` starts, Cloudflare offers quick tunnels for testing with no uptime guarantee, and the laptop must stay on, awake and online for the whole tour. Prefer recipe 1 for the pilot itself.

Commands are for macOS with Homebrew. On Linux, install Node 22 as in recipe 1 and `cloudflared` from https://github.com/cloudflare/cloudflared/releases.

### 1. Install and build

```bash
brew install node@22 cloudflared
git clone [FOUNDER: public repository URL] verapass
cd verapass
npm ci
npm run build
```

### 2. The settings file

From the repository root, create `.env` and fill it the same way as recipe 1, step 4:

```bash
(umask 077 && touch .env)
node -e "const c=require('crypto'),fs=require('fs');const pem=c.generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'}).replace(/\n/g,'\\\\n');fs.appendFileSync('.env','TRAVELLER_SECRET='+c.randomBytes(32).toString('hex')+'\nRECEIPT_SIGNING_KEY='+pem+'\n',{mode:0o600})"
```

If this laptop deployed the contract, add the attestor key straight from the keystore; otherwise pipe it over SSH from the machine that did, as in recipe 1:

```bash
{ printf STELLAR_SECRET=; contracts/.tools/bin/stellar keys secret verapass-attestor; } >> .env
```

Then the plain settings:

```bash
cat >> .env <<'EOF'
NODE_ENV=production
VERAPASS_CONTRACT_ID=CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65
ALLOW_SIMULATED_CHECKINS=false
SERVE_STATIC=true
TRUST_PROXY=true
EOF
node --env-file=.env scripts/pilot-preflight.mjs
```

The preflight warns that `PUBLIC_ORIGIN` is missing. That is fine: the tunnel address is not known yet, and the server only uses it after card checkout.

### 3. Start the server and the tunnel

Turn on the macOS firewall (System Settings, Network, Firewall) so no one on the same Wi-Fi reaches port 8787 directly. Then, in one terminal:

```bash
caffeinate -is npm start 2>&1 | tee -a verapass-pilot.log
```

`caffeinate -is` keeps the Mac from sleeping while the server runs (on mains power). In a second terminal:

```bash
cloudflared tunnel --url http://localhost:8787
```

It prints an address like `https://some-random-words.trycloudflare.com`. Check it:

```bash
node --env-file=.env scripts/pilot-preflight.mjs --server https://some-random-words.trycloudflare.com
```

Make the QR code for that address. When `cloudflared` restarts, the address changes and the QR code has to be made again.

## TRUST_PROXY

The server limits new passports and API calls per IP address. With `TRUST_PROXY=true` it takes the IP from the last entry of `X-Forwarded-For`, the one the proxy in front of it wrote; without it, every request seems to come from the proxy, so all guests share one budget (30 new passports an hour and 60 calls a minute per route, for everyone together) and one noisy client can lock everyone out.

- Behind Caddy (recipe 1) there is only one entry, the real client address, because Caddy replaces whatever the client sent. Keep port 8787 closed so nothing reaches Node without Caddy.
- Behind a Cloudflare tunnel (recipe 2) Cloudflare appends the client address to any `X-Forwarded-For` the client sent. The server reads the last entry, so a made-up address the client puts in front changes nothing (test "a made-up first X-Forwarded-For entry does not buy a fresh per-IP budget").

## Logs, restarts and updates

What the server logs: the startup line (payments mode, attestation mode and contract id, simulation setting, state store), configuration warnings, and errors (state store unavailable, unhandled errors, a check-in lock that could not be released). It does not log requests, guest IPs or any key.

| | VM | Laptop |
|---|---|---|
| Follow the log | `sudo journalctl -u verapass -f` | the first terminal, or `tail -f verapass-pilot.log` |
| Proxy log | `sudo journalctl -u caddy -f` | the `cloudflared` terminal |
| Restart | `sudo systemctl restart verapass` | Ctrl-C, then start again |

State lives in the server's memory: check-in nonces, rate-limit counts, the last fix per traveller for the speed check, and the status of stamps still being submitted. A restart clears all of it. Guests in the middle of a check-in see an error and try again; a stamp transaction that was already sent is on chain either way. Restart and update between tours, not during one.

To update the VM to a new version of the code:

```bash
cd /opt/verapass/app
sudo -u verapass git pull
sudo -u verapass npm ci
sudo -u verapass env SITE_URL=https://pilot.example.org npm run build
sudo -u verapass node --env-file=.env scripts/pilot-preflight.mjs
sudo systemctl restart verapass
```

Run only one server instance. Two instances with in-memory state reject each other's check-ins.

## What to back up

| What | Where | Why |
|---|---|---|
| `TRAVELLER_SECRET` and `RECEIPT_SIGNING_KEY` | the `.env` on the server; copy both once into the founders' password manager, nowhere else | Losing `TRAVELLER_SECRET` breaks every guest's passport id and gives returning guests new addresses. Losing `RECEIPT_SIGNING_KEY` makes earlier receipts stop verifying against the server's key |
| `STELLAR_SECRET` | already in the Stellar CLI keystore of the deploy machine | Needed to rebuild the server. Do not make extra copies |
| The receipt public key | `receiptPublicKey` in `/api/health`; record it with the pilot evidence | Lets anyone verify pilot receipts later ([Verify a check-in receipt](verify-a-receipt.md)) |
| The server log | `journalctl -u verapass --since "<first pilot day>" > verapass-pilot.log` on the VM, or `verapass-pilot.log` on the laptop, at the end of the pilot | A record of the server's mode and of any errors during the pilot |

Nothing else on the server needs a backup. The stamps are on the testnet contract, each guest's passport and receipts live in the guest's own browser, and Caddy renews its certificate by itself. Never put `.env` in git, a shared drive or a document; `.gitignore` already excludes it.

Stellar testnet resets on 2026-12-16. After that the contract is redeployed with a new id (`contracts/DEPLOYMENT.md`), and `VERAPASS_CONTRACT_ID` must be updated.
