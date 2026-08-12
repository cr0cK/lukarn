# Deploying and operating

Everything needed to get from nothing to a running instance, and to keep it
running. For what the application is and how to run it locally, see the
[root README](../README.md); for why it is built this way, see
[`specs/06`](../specs/06-configuration-et-deploiement.md).

| File              | Role                                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| `cloud-init.yaml` | Provisions a fresh machine: account, security updates, Docker, ufw, VPN    |
| `deploy.sh`       | Updates a live instance and waits for it to come back healthy              |
| `backup.sh`       | Archives the `nonni-data` volume and its `.env`, then ships it off-machine |

---

This needs a Debian or Ubuntu VPS and a domain name whose `A` record — and
`AAAA` if the VPS has IPv6 — already points at its address. The TLS certificate
is obtained automatically from that name: without DNS in place, step 5 fails.

## Two ways in, and the sizing follows from which one you pick

**The published image**, `ghcr.io/cr0ck/nonni`, is what `docker-compose.yml`
references by default. Updating pulls a few hundred megabytes and restarts:
nothing is compiled on the machine.

**Building from source** is one overlay file away, and it is the answer whenever
the image does not fit — a host that is not `linux/amd64`, a local modification to
try, or a plain refusal to depend on someone else's registry. The repository is
the source of truth; the image is a convenience.

```bash
./deploy/deploy.sh            # pull the published image
./deploy/deploy.sh --build    # build from source
```

| Sizing   | From the image | Building on the machine |
| -------- | -------------- | ----------------------- |
| **vCPU** | 1              | 2                       |
| **RAM**  | 1 GB           | **4 GB**                |
| **Disk** | 40 GB          | 60 GB                   |

The RAM gap is the whole story: `tsc` plus `better-sqlite3`, `argon2` and `sharp`
compiling from source when no prebuilt binary fits. At 1 GB the OOM killer ends
the build before it finishes, and the message it leaves behind looks nothing like
the cause.

Disk is dominated by neither: **the cache targets 20 GB by default**
(`cache.maxSizeGB`, adjustable in `/admin`), on top of the image and the system.
Below 40 GB, LRU eviction runs permanently — it works, it just throws away
thumbnails it will regenerate an hour later.

**Pinning a version.** `latest` follows every release. `NONNI_VERSION=1.0.0` in
the `.env` freezes it, and a `docker compose pull` then changes nothing until you
raise the number — which is what you want if an update should be a decision
rather than a surprise.

## 0. On the administration workstation

One key and one VPN client, to put in place **before** creating anything.

```bash
# 1. An ed25519 key — the one cloud-init will install on the server.
ssh-keygen -t ed25519

# 2. Tailscale — on the workstation TOO, not only on the server.
curl -fsSL https://tailscale.com/install.sh | sh
sudo systemctl enable --now tailscaled
sudo tailscale up          # opens a URL: this is where the account is created
```

**Tailscale on both sides, or step 2 cannot complete.** It is a mesh VPN: every
machine that connects joins the same private network, receives a stable
`100.x.y.z` address and a name (`galerie.<tailnet>.ts.net`). The
`ssh deploy@<tailnet-name>` that serves as the administration door works only if
**both** machines are on that network — a server alone on it can be reached from
nowhere. Nothing has to be opened inbound for it: Tailscale goes out over UDP
41641 and falls back to a DERP relay when NAT prevents that.

Tailscale is not a dependency of the application: it is this repository's choice
for administrative access, because it closes port 22 without opening anything in
exchange. Bare WireGuard, a bastion host, or port 22 filtered by source IP serve
the same purpose — step 2 then has to be adapted, and nothing else changes.

Finally, **copy the public key into `cloud-init.yaml`**, replacing the
`ssh-ed25519 AAAA_REMPLACER…` line:

```bash
cat ~/.ssh/id_ed25519.pub
```

Left as it is, the server's `deploy` account will accept no connection at all.

## 1. Create the machine

Any provider will do, as long as it offers a **Debian 12+ or Ubuntu LTS** image
and accepts **cloud-init** — exposed as "user data" or "cloud-config" depending
on the interface.

Cloud-init is a de facto standard rather than a published one: a single
open-source implementation that virtually every Linux cloud image ships and that
every major provider feeds. The same file therefore works from one host to the
next. The exceptions are worth knowing: Fedora CoreOS and Flatcar use
**Ignition** instead, Windows uses **cloudbase-init**, and a minimal or custom
image may simply not include the package. In those cases, follow the
"Without cloud-init" section under step 2.

Three things to obtain, whatever console is used:

| To do                                                               | Why                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Pass `deploy/cloud-init.yaml` as "user data"                        | It performs the whole of step 2: account, firewall, Docker, Tailscale    |
| Open **80/tcp, 443/tcp, 443/udp**, and **22/tcp for the bootstrap** | 80 serves the ACME challenge, 443/udp serves HTTP/3. 22 closes in step 2 |
| Note the public IP and **create the `A` record straight away**      | Let's Encrypt checks the name at first startup, not later                |

The file is read **from a local clone** of the repository, not from the server,
which does not exist yet:

```bash
git clone <this-repo> && cd nonni
```

<details>
<summary>Example with a provider CLI</summary>

None of these providers is required or recommended — they are illustrations of
the same operation. Instance ranges, prices and image names change: check them at
provisioning time.

**Hetzner** (`hcloud`):

```bash
hcloud server create --name galerie --type cx22 --image debian-12 \
  --ssh-key <key-name> --user-data-from-file deploy/cloud-init.yaml
hcloud firewall create --name galerie
# then open 22, 80, 443/tcp and 443/udp on that firewall
```

**DigitalOcean** (`doctl`):

```bash
doctl compute droplet create galerie --image debian-12-x64 --size s-2vcpu-4gb \
  --ssh-keys <fingerprint> --user-data-file deploy/cloud-init.yaml
```

**Scaleway** (`scw`):

```bash
scw instance security-group create name=galerie zone=fr-par-2 \
  inbound-default-policy=drop outbound-default-policy=accept
SG=$(scw instance security-group list name=galerie zone=fr-par-2 -o json | jq -r '.[0].id')
for p in 22 80 443; do
  scw instance security-group create-rule security-group-id=$SG zone=fr-par-2 \
    direction=inbound action=accept protocol=TCP dest-port-from=$p
done
scw instance security-group create-rule security-group-id=$SG zone=fr-par-2 \
  direction=inbound action=accept protocol=UDP dest-port-from=443   # HTTP/3

scw instance server create name=galerie zone=fr-par-2 \
  type=PLAY2-NANO image=debian_bookworm \
  root-volume=b_ssd:60G ip=new security-group-id=$SG \
  cloud-init=@deploy/cloud-init.yaml
```

A web console does the same thing: the "user data" or "cloud-config" field
expects the contents of `deploy/cloud-init.yaml`, and the firewall is configured
alongside it.

</details>

## 2. Join the tailnet, then close SSH

The cloud-init passed at creation time has already set everything up: the
`deploy` account (sudo, key-only, no password), automatic security updates,
Docker, `rclone`, Tailscale, and a `ufw` that lets through only 22, 80 and 443.
It installs **neither Node nor pnpm** — everything that runs on this machine runs
in a container, and administrative commands go through `docker compose`.

**What remains is authenticating Tailscale, then closing SSH on the public
interface.** Cloud-init installs Tailscale but does not authenticate it: that
means approving a URL in a browser, which is a human action. Until it has
happened there is only one path to the machine, and closing it makes the machine
unreachable. The order:

```bash
ssh deploy@<public-ip>
sudo tailscale up                      # opens a URL to approve

# In a SECOND terminal, without closing the first. Assumes the workstation is on
# the tailnet (§ 0): otherwise this name resolves nowhere.
ssh deploy@<tailnet-name>              # must work

# Only then, in the first one:
sudo ufw delete allow OpenSSH
sudo sed -i 's/^PermitRootLogin .*/PermitRootLogin no/' \
  /etc/ssh/sshd_config.d/99-hardening.conf
sudo systemctl reload ssh
```

On a machine bootstrapped before 1.0.0 that file is still called
`99-durcissement.conf`; the rename only applies to machines created afterwards,
and there is nothing to migrate.

Then remove the port 22 rule from the provider's firewall, if it offers one in
front of the machine — most do, under the name security group, firewall or
network rules. `ufw` alone is enough to block the port; the upstream rule merely
keeps the packet from arriving at all.

> **Do not close the door you came in through before having walked through the
> other one**, from a separate terminal. This is the one moment of the install
> where a typo costs a reinstall. Safety net: the provider's out-of-band
> console — serial, KVM or VNC depending on the case. **Check that it exists and
> that it opens before closing anything**: not every provider offers one.

Tailscale needs **no inbound opening**: it goes out over UDP 41641 and falls back
to a DERP relay when NAT prevents that. The provider firewall and `ufw` can stay
at "everything closed except 80 and 443".

<details>
<summary>Without cloud-init — another provider, or a machine already created</summary>

The same content, by hand, as root on first connection.

**An account of one's own, a key, and no more passwords.** An exposed server
receives SSH login attempts continuously, a few thousand a day. They become
pointless as soon as no password is accepted.

```bash
adduser deploy && adduser deploy sudo
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # reuses the key
```

```bash
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
```

```bash
systemctl restart ssh
```

> **Keep the root session open** and check in a **second** terminal that
> `ssh deploy@…` works before closing it.

**The firewall.** Three ports open, nothing else. The application listens on no
public interface — only Caddy is reachable — but a firewall also covers whatever
gets installed later without thinking about it.

```bash
apt install ufw
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw enable
```

`443/udp` serves HTTP/3; omitting it breaks nothing, browsers fall back to TCP.

**Security updates, without thinking about them.** This is the highest-return
measure of the five: opportunistic intrusions target vulnerabilities published
months ago.

```bash
apt install unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

**Docker.**

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy   # log out and back in for this to take effect
```

Adding `deploy` to the `docker` group amounts to granting root on the machine —
which it already has, being `sudo`. On a server shared with someone who should
not have it, prefer `sudo docker`.

</details>

Everything that follows is done with the `deploy` account.

## 3. Give the server access to the Drive

Two ways, take either. The first avoids Google's warning screen and has nothing
to renew: it is the one to prefer for a new install.

|                                          | Service account             | OAuth                               |
| ---------------------------------------- | --------------------------- | ----------------------------------- |
| "Google hasn't verified this app" screen | Never                       | On every consent                    |
| To renew                                 | Nothing                     | Token expires after six months idle |
| What the server can read                 | The folders that are shared | **All** of the Drive                |
| Per new album                            | Share its folder            | Nothing                             |

### Option A — service account (recommended)

1. In the [Google Cloud console](https://console.cloud.google.com/), create a
   project, then **APIs & Services → Library**: enable **Google Drive API**.
2. **IAM & Admin → Service Accounts → Create**. No role to grant: this account
   touches nothing in the project, it only serves as an identity.
3. On the created account: **Keys → Add key → Create → JSON**. The file
   downloads once and only once.
4. Place it outside the repository, for instance `./config/service-account.json`,
   and set `GOOGLE_SERVICE_ACCOUNT_FILE` in `.env`. It contains a private key:
   protect it like a password (`chmod 600`).
5. **Share the folder with the service account.** This is what replaces consent,
   and the only step to repeat for each new album:

   - get the service account address — `/admin` shows it at the top, it looks
     like `galerie@my-project.iam.gserviceaccount.com`;
   - in **Google Drive**, right-click the album folder → **Share**;
   - paste the address, leave the role at **Viewer**, untick "Notify people"
     (that mailbox does not exist), then **Share**.

   Sharing is **inherited**: a shared folder grants access to everything it
   contains, subfolders included. A `recursive: true` album therefore needs a
   single share at the root — and a photo added later inherits it too.

   **The trap to know about**: a forgotten folder produces no error, neither in
   `/admin` nor in the logs. Only an empty album. If an album stays at zero items
   after an "ok" sync, sharing is the first thing to check.

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` become unnecessary, as does the
"Connect Google Drive" button in `/admin`, which gives way to the address to
share with.

### Option B — OAuth

Everything happens in the [Google Cloud console](https://console.cloud.google.com/),
in a **dedicated project** rather than a catch-all one: the consent screen is
unique per project and carries the displayed name, the scopes and the publication
status. Hosting several applications in one mixes them into a single
authorisation request.

1. Create a project, then **APIs & Services → Library**: enable **Google Drive
   API**.
2. **OAuth consent screen** (also presented as _Google Auth Platform_): type
   **External**, application name and support address.
3. **Publish the application.** This step is required: while it stays in
   "Testing" status, Google **expires the refresh token after 7 days** and
   reconnection is needed every week.

   Publishing triggers no verification process unless one is requested. The
   application stays "published, unverified", capped at 100 users. The only
   consequence is a "Google hasn't verified this app" screen at consent time —
   go through **Advanced → Go to**. Once, and only for the owner.

   _(With a Google Workspace account, the "Internal" type avoids that screen. It
   is not offered to `gmail.com` addresses.)_

4. **Credentials → Create → OAuth client ID**, type **Web application**.
5. Under "Authorised redirect URIs", add exactly `PUBLIC_URL` followed by
   `/api/oauth/callback`, for example:
   `https://photos.example.com/api/oauth/callback`

## 4. Configuration

**On the server**, with the `deploy` account — the clone from step 1 was on the
administration workstation, for cloud-init.

```bash
git clone <this-repo> && cd nonni

cp .env.example .env
# Generate both secrets and paste them into .env
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # TOKEN_KEY
# Also set PUBLIC_URL, then, depending on the option chosen in step 3:
#   GOOGLE_SERVICE_ACCOUNT_FILE  (service account)
#   GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET  (OAuth)
# SMTP_URL and MAIL_FROM: required for comments — see step 6
```

There is **no `pnpm install` here**: the machine has neither Node nor pnpm, and
needs neither. Everything runs inside the image — pulled or built in the next
step — and the first administrator is created from the container.

Accounts, albums and settings are then administered **from `/admin`**, with no
file to edit and no restart.

`config/albums.example.yaml` remains usable to **bootstrap** a fresh install in
one go: copied to `config/albums.yaml` (with hashes produced by
`pnpm hash-password`, **from a development workstation** — that command needs
pnpm), it is imported into the database at first startup and never read again.
Unnecessary when going through `create-admin`.

Each album points at a Drive folder by its `folderId`: the segment after
`/folders/` in the folder URL.

```
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
                                       ^--------- folderId ------^
```

A path (`/Holidays/photos/2026-07-Germany`) will not do: the Drive API only
handles identifiers. Open the wanted folder — the deepest one for an album per
trip, since `recursive: true` pulls in every subfolder — and copy the segment
from its URL. That identifier survives renames and moves.

## 5. Startup and first administrator

```bash
docker compose up -d
```

Building from source instead — a host that is not `linux/amd64`, or a local
change to try:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Two containers start: the application, and **Caddy**, which handles TLS. The
Let's Encrypt certificate is requested at first startup and renewed on its own —
there is no scheduled task to write and no certificate to watch.

The application **publishes no port**: it is reachable only through Caddy, on the
compose-internal network. The single setting is `PUBLIC_URL`, which gives Caddy
the domain to serve at the same time as it builds the OAuth redirect URI, so the
two cannot diverge. It must be exactly `https://photos.example.com`, with no
trailing `/`.

```bash
docker compose logs -f caddy    # "certificate obtained successfully"
```

When the certificate does not arrive it is almost always DNS: the name must point
at the VPS IP **before** first startup, and port 80 must be open (Let's Encrypt
uses it for validation).

Is a proxy already running on the machine — nginx, Traefik, another application
on 443? Remove the `caddy` service from `docker-compose.yml` and give `app` its
local publication back — `ports: ['127.0.0.1:8080:8080']` — then proxy to it.
Security headers are set by the application, so they hold whatever the front end
is.

**The first administrator**, once the containers are up. The `pnpm create-admin`
of local development has no equivalent here: there is no pnpm on the machine. The
script lives in the image, compiled, and runs inside the container:

```bash
docker compose exec app node packages/server/dist/scripts/create-admin.js alexis
```

The password is prompted without being displayed. Passing it as an argument
(`… create-admin.js alexis someSecret`) also works but leaves it in the shell
history.

Writing to the database while the application runs is safe: `ConfigRepo` watches
`PRAGMA data_version` and rebuilds its snapshot as soon as a write comes from
elsewhere. That holds for **separate** processes only — which is exactly what
`docker compose exec` provides.

To create the account before the first startup instead, `run` does the same thing
without `app` running:

```bash
docker compose run --rm app node packages/server/dist/scripts/create-admin.js alexis
```

## 6. Email — optional, but required for comments

Without a sending server nobody can comment: the code that verifies an address
travels by email. New-photo announcements will not go out either. `SMTP_URL` and
`MAIL_FROM` go together — setting only one prevents startup.

### With Gmail

Google has refused account passwords since "less secure app access" ended. An
**app password** is required, which serves only for sending and can be revoked on
its own:

1. Enable **two-step verification** on the Google account — without it, the
   option does not appear.
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords),
   name the application ("Galerie"), confirm.
3. Google displays **16 letters in four groups**: copy them **without the
   spaces**.

```bash
# The @ in the address must be encoded as %40: without that, the URL is cut at
# the wrong place and the host becomes anything at all.
SMTP_URL=smtps://first.last%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465
MAIL_FROM=Galerie <first.last@gmail.com>
```

- `smtps://` and port **465**: TLS from the start of the connection. Port **587**
  with `smtp://` works too (STARTTLS). Both are commonly blocked outbound by
  hosting providers — see [below](#when-nothing-leaves-the-machine) when the
  connection times out.
- `MAIL_FROM` must carry **the account address** or a verified alias: Gmail
  rewrites or rejects any other sender.
- Gmail caps sending at a few hundred recipients a day. Irrelevant for a family
  gallery.
- **A password containing `/`, `?` or `#` cuts the URL** in the middle of the
  credentials. The server then refuses to start and says so: encode those
  characters (`%2F`, `%3F`, `%23`), as with `@` → `%40`. Google app passwords
  contain none of them. `+`, `:` and spaces pass through unencoded.

### When nothing leaves the machine

A connection that times out, with no SMTP error in sight, is not a credentials
problem: the host is filtering outbound ports. Nearly all of them block **25**,
and many block **465** and **587** too — spam leaving a compromised instance is
their problem before it is anyone else's. Nothing reports this; the connection
simply never completes.

Find out what gets out before suspecting the password:

```bash
for p in 25 465 587 2465 2587; do
  timeout 5 bash -c "exec 3<>/dev/tcp/smtp.example.com/$p" 2>/dev/null \
    && echo "$p open" || echo "$p blocked"
done
```

Relays publish alternative ports for exactly this reason, usually **2465** for
implicit TLS and **2587** for STARTTLS. Some hosts also lift the block on
request — a support ticket, and not always granted.

**Keep the scheme consistent with the port.** nodemailer reads the encryption
from the URL scheme, never from the port number: `smtps://` opens TLS on the
first byte, `smtp://` starts in the clear and upgrades through STARTTLS. So
`smtps://…:2465` is right, and `smtp://…:2465` negotiates nothing and hangs.

### Sending from the site's own domain

A relay signing for the site's own domain — `galerie@photos.example.com` rather
than someone's personal mailbox — needs three DNS records. Gmail and Yahoo have
required them of bulk senders since February 2024, and here they decide whether a
visitor's verification code arrives in the inbox or in the spam folder.

| Record        | Answers                                                        |
| ------------- | -------------------------------------------------------------- |
| `SPF` (TXT)   | which servers may send for this domain                         |
| `DKIM` (TXT)  | is this message authentic and unaltered                        |
| `DMARC` (TXT) | what to do when the first two disagree — `p=none` to start out |

Two traps, both silent:

- **SPF is a `TXT` record, and there must be exactly one.** Registrar interfaces
  still offer a dedicated `SPF` record type (RRtype 99), abandoned by RFC 7208 in
  2014 and queried by nobody: the value reads correctly in the zone and reaches
  no one. Two SPF records is worse still — a `permerror`, which counts as no SPF
  at all. A domain that already sends mail takes one merged record, not a second.
- **An MX pointing at a "blackhole" is a default offered, not a requirement.** It
  exists for domains with no mail service of their own, and it discards every
  incoming message. A domain that already has an MX keeps it, and domain
  verification passes just the same.

### Where replies go

A transactional relay sends; it does not receive. So `MAIL_FROM` naming an
address on the site's own domain says nothing about whether that address has a
mailbox behind it — and recipients do reply to a notification about a comment on
a family photo. The reply bounces at their end, and no server log here ever shows
it.

There are two ways out. The cheap one:

```bash
MAIL_REPLY_TO=first.last@example.com   # replies land in an existing mailbox
```

`MAIL_REPLY_TO` is optional and independent of the pair above. It sets the
`Reply-To` header while `MAIL_FROM` stays on the domain that SPF and DKIM sign —
changing the sender to dodge this is what puts messages in the spam folder. The
cost is that the address is visible to every recipient, like any header. Left
empty, no header is set and replies follow `MAIL_FROM`.

The alternative is a real mailbox, or a forwarding address, on the domain
itself — from the registrar, from a mail host, or from a forwarding service.
Mailbox plans and free forwarding both exist depending on the provider; what
matters is that `galerie@example.com` resolves somewhere, and that the domain
keeps a working `MX` (see the blackhole trap above).

### Checking rendering before writing to anyone

A local stub relay avoids sending real messages during trials:

```bash
docker run -d --rm -p 1025:1025 -p 8025:8025 axllent/mailpit
# then in .env: SMTP_URL=smtp://localhost:1025
```

Mailpit accepts everything, relays nothing, and displays messages at
`http://localhost:8025`.

## 7. Connect the Drive

With a **service account** there is nothing to do here: access comes from sharing
the folder (step 3). This step concerns **option B** only, and happens once, done
by the Drive owner:

1. Open `https://photos.example.com` and sign in with an administrator account.
2. Go to **/admin** → **Connect Google Drive**.
3. Pick the Google account and accept. Get past the "Google hasn't verified this
   app" screen through **Advanced → Go to**.

On return, the first sync starts by itself and albums fill within seconds. From
then on, visitors sign in with their username and password, never going through
Google.

## Operating

| Action                         | How                                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add an album or a user         | `/admin`, effective immediately                                                                                                                                               |
| Add an album (service account) | `/admin`, **then share its Drive folder** with the account address — otherwise the album stays empty, with no error                                                           |
| Change an interval or a limit  | `/admin`, applied without restart                                                                                                                                             |
| Force a sync                   | **Resynchronise** in `/admin`                                                                                                                                                 |
| See sync status                | `/admin`                                                                                                                                                                      |
| Moderate a comment             | `/admin`, **Comments** section: hide, or make visible again                                                                                                                   |
| Enable comments                | `SMTP_URL` and `MAIL_FROM` in `.env` (see step 6) — without a sending server nobody can identify themselves                                                                   |
| Get notified of comments       | Set the moderation address in `/admin`                                                                                                                                        |
| Annotate a day                 | Open the album **grouped by day**, hover the date, click the pencil. The default grouping is set per album in `/admin`                                                        |
| Turn off place geocoding       | `GEOCODING_URL=` (empty) in `.env`. By default, coordinates rounded to the kilometre go to Nominatim/OSM to name days; a private Nominatim instance goes in the same variable |
| Administrator password lost    | `docker compose exec app node packages/server/dist/scripts/reset-password.js <username>` — also closes that account's open sessions                                           |
| Update                         | `./deploy/deploy.sh` — backs up, rebuilds, and **waits** for the health check to go green again                                                                               |
| Back up                        | `./deploy/backup.sh` — the `nonni-data` volume **and** the `.env`, see below. `nonni-cache` is regenerable                                                                    |
| Read the logs                  | `docker compose logs -f` (or `logs -f caddy` for the certificate)                                                                                                             |

Updating an instance that was running on `config/albums.yaml`: nothing to do. At
first startup its accounts, albums, rights and settings are imported into the
database as they are, with no reindexing and no new Google consent. The file is
never read again afterwards — `/admin` is the source of truth.

Albums are resynchronised automatically at the interval set in `/admin`. Nothing
is ever written to Drive: the requested scope is read-only.

## Backup

Two things, and they go together: the `nonni-data` volume holds the accounts, the
index and the **encrypted** refresh token, which only `TOKEN_KEY` decrypts. A
backup of the volume without the `.env` yields an unreadable token and forces a
new Google consent. `backup.sh` takes both.

A third piece rides along, `config/`, because it lives on the host rather than in
the volume: it carries `service-account.json`, which Google hands over once and
never again. Without it a restore returns the database and the accounts, and no
access to Drive at all — a failure that only shows up at the first sync.

Three files per run, then:

| File                           | Holds                                            |
| ------------------------------ | ------------------------------------------------ |
| `nonni-<timestamp>.tar.gz`     | the `nonni-data` volume — accounts, index, token |
| `nonni-<timestamp>.env`        | the secrets, `TOKEN_KEY` first among them        |
| `nonni-<timestamp>.config.tgz` | `config/`, absent on an OAuth-only install       |

```bash
./deploy/backup.sh            # local archive, then upload through rclone
./deploy/backup.sh --local    # local archive only
```

The script stops `app` for the duration of the `tar` — a few seconds, the price
of a SQLite at rest rather than a file copied with a WAL in flight — writes
`backups/nonni-<timestamp>.tar.gz` with the `.env` alongside it, keeps the
**last 7** and deletes the older ones. It checks that the archive really contains
`nonni.db`: an empty archive would otherwise go unnoticed until restore time.

**Off the machine.** A backup that lives on the machine it protects protects
nothing. Without `--local`, the script copies the archive through `rclone` to a
remote configured **outside the repository**:

```bash
rclone config     # any backend: S3 and compatibles, B2, SFTP…
# The default remote is `backups:nonni`. Another name?
# NONNI_BACKUP_REMOTE=my-remote:my-bucket ./deploy/backup.sh
```

`NONNI_BACKUP_DIR` moves the local directory the same way. An instance
bootstrapped before 1.0.0 wrote into `sauvegardes/` and configured its rclone
remote as `sauvegardes:` — either rename both, or keep them by setting
`NONNI_BACKUP_DIR` and `NONNI_BACKUP_REMOTE`. Pruning only looks in the directory
it is pointed at, so archives left in the old one stay there until removed by
hand.

**Automating.** Two units, and nothing to install: Debian and Ubuntu cloud
images ship systemd but frequently **no `cron` at all** — `crontab` is simply not
a command there.

```ini
# /etc/systemd/system/nonni-backup.service
[Unit]
Description=Gallery backup (nonni-data volume and its .env)
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
User=deploy
WorkingDirectory=/home/deploy/nonni
# rclone reads ~/.config/rclone/rclone.conf. Without HOME it finds no remote,
# and the off-machine copy fails while the local archive succeeds — the kind of
# half-failure that goes unnoticed until a restore.
Environment=HOME=/home/deploy
ExecStart=/home/deploy/nonni/deploy/backup.sh
TimeoutStartSec=30min
```

```ini
# /etc/systemd/system/nonni-backup.timer
[Unit]
Description=Daily gallery backup

[Timer]
OnCalendar=*-*-* 04:00:00
# Runs a missed occurrence at the next boot. cron does not.
Persistent=true
RandomizedDelaySec=15min

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nonni-backup.timer
systemctl list-timers nonni-backup.timer   # when it next fires
sudo systemctl start nonni-backup.service  # run one now, without waiting
journalctl -u nonni-backup.service         # what it did
```

The output goes to the journal, so there is no log file to rotate and nothing
appended to a file nobody reads. Where `cron` **is** installed, one `crontab -e`
line does the same job, minus the catch-up after downtime:

```cron
0 4 * * * cd /home/deploy/nonni && ./deploy/backup.sh >> /home/deploy/sauvegarde.log 2>&1
```

`nonni-cache` does not need backing up: it regenerates.

**Restoring**, on a fresh machine, from a clone of the repository and **before**
the first `docker compose up`:

```bash
cp nonni-<timestamp>.env .env          # the secrets, TOKEN_KEY included
tar xzf nonni-<timestamp>.config.tgz   # recreates config/, service account key and all

docker volume create nonni-data
docker run --rm -v nonni-data:/data -v "$PWD:/e" alpine \
  tar xzf /e/nonni-<timestamp>.tar.gz -C /data
```

The volume archive keeps the layout it has always had — the files sit at its
root, not under a directory — so an archive produced before `config/` was
included restores with the very same command. What is missing from those older
ones is the key, and a new one costs three clicks in the console
(**Keys → Add key**, then revoke the old one). No album has to be re-shared:
folders are shared with the service account, never with one of its keys.

> **Updating an instance that ran under the project's former name.** The project
> was called `googledrive-viewer` until version 1.0.0, and its volumes and
> database carried a `gdv` prefix. Nothing adopts the new names on its own: run
> this **before** the first `docker compose up` on this version, or the
> application starts on an empty database — accounts and index included.
>
> ```bash
> docker compose down
> docker volume create nonni-data
> docker run --rm -v gdv-data:/old -v nonni-data:/new alpine sh -c '
>   cp -a /old/. /new/
>   mv /new/gdv.db /new/nonni.db
>   # A clean shutdown checkpoints the WAL, so these two are usually absent.
>   # Leaving them behind under the old name would silently drop whatever the
>   # last transactions had not yet folded into the database file.
>   [ -e /new/gdv.db-wal ] && mv /new/gdv.db-wal /new/nonni.db-wal
>   [ -e /new/gdv.db-shm ] && mv /new/gdv.db-shm /new/nonni.db-shm
>   exit 0'
> docker compose up -d
> ```
>
> `nonni-cache` is not worth copying: it regenerates. Once the instance is
> verified, `docker volume rm gdv-data gdv-cache` reclaims the space. Backups
> already on disk keep their `gdv-` prefix, and pruning no longer sees them —
> delete them by hand once a `nonni-` archive has been restored successfully.

> **Updating an instance older than the explicit volume names.** Volumes carry a
> `name:` of their own since D53. Before that, compose prefixed them with the
> working directory, so the volume is called `<directory>_gdv-data` —
> `googledrive-viewer_gdv-data` when cloned under that name; `docker volume ls`
> gives the exact one. Substitute it for `gdv-data` in the commands above, and
> copy the certificates across too, which spares a reissue:
>
> ```bash
> docker run --rm -v googledrive-viewer_caddy-data:/old -v caddy-data:/new alpine \
>   sh -c 'cp -a /old/. /new/'
> ```
