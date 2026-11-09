# Email setup

OpenQZ sends three kinds of email: password reset links (single use, 30 minutes), "new activity assigned" and "marks released". The worker sends them. If `SMTP_HOST` is blank, nothing is sent and "Forgot your password?" is hidden.

There are two ways to run email locally, and two for servers.

| Where | Mail goes to | Files |
| --- | --- | --- |
| Local, default | **Mailpit**, a fake inbox at http://localhost:8025. Nothing leaves your machine. | `compose.yaml` + `compose.dev.yaml` |
| Local, real mail | The real mail server, through a Cloudflare tunnel | `compose.yaml` + `compose.dev.yaml` + `compose.mail.yaml` |
| Staging / production, mail server elsewhere | The mail server or college relay, by its public name | `compose.yaml` + `compose.prod.yaml`, see the [runbook](runbook.md#email-password-reset-and-notifications) |
| Staging / production, mail server **on the same machine** | The local mail server on port 587 | `compose.yaml` + `compose.prod.yaml` + `compose.mail.yaml` (`make prod-up LOCAL_MAIL=1`), see [section 3](#3-server-with-its-own-mail-server-port-587) |

## 1. Local default: Mailpit

Nothing to configure. `compose.dev.yaml` points the api and worker at Mailpit and ignores the `SMTP_*` login in `.env`, so you can keep real values in `.env` without sending real mail.

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d
```

Open http://localhost:8025 to read every message (password resets, assignment emails). Use this mode for the browser tests: the seed users have made-up addresses, and real mail to them would bounce and hurt the sender's reputation.

## 2. Local with the real mail server (Cloudflare tunnel)

The mail server (`mail.webuildnow.in`, Postfix) does not accept SMTP connections from outside. It is published through Cloudflare as `smtp-tunnel.webuildnow.in`, and `cloudflared` on your machine turns that into a local port.

```
api / worker container
   | SMTP to mail.webuildnow.in:1587 (STARTTLS)
   | extra_hosts sends that name to your machine (host-gateway)
   v
cloudflared on your machine, listening on 1587
   | Cloudflare tunnel
   v
smtp-tunnel.webuildnow.in -> Postfix on mail.webuildnow.in
```

### Step 1: install cloudflared

- Windows: `winget install --id Cloudflare.cloudflared`
- macOS: `brew install cloudflared`
- Linux: the package from https://pkg.cloudflare.com

Check with `cloudflared --version`.

### Step 2: start the tunnel

Keep this running in its own terminal while you work:

```bash
cloudflared access tcp --hostname smtp-tunnel.webuildnow.in --url localhost:1587
```

It prints `Start Websocket listener host=localhost:1587`. No Cloudflare sign-in is needed.

**Linux only:** containers cannot reach a port bound to `localhost` on a Linux host. Use `--url 0.0.0.0:1587` instead, and block port 1587 from the network in your firewall (anyone who can reach it can talk to the mail server through your tunnel).

Quick check that the tunnel works (Windows PowerShell):

```powershell
Test-NetConnection localhost -Port 1587
```

`TcpTestSucceeded : True` means it is up. With `telnet localhost 1587` or `nc localhost 1587` you see `220 mail.webuildnow.in ESMTP Postfix`.

### Step 3: fill in `.env`

```dotenv
SMTP_HOST=mail.webuildnow.in        # the real name, not localhost: it must match the server's certificate
SMTP_PORT=1587                      # the local tunnel port
SMTP_USER=dbit-oscc                 # the mailbox login, ask the mail admin
SMTP_PASSWORD=...                   # never commit this
SMTP_FROM=OpenQZ <dbit-oscc@webuildnow.in>   # must be a domain this server may send for, see below
SMTP_STARTTLS=true
SMTP_SSL=false
```

**The sender address matters.** Gmail and Outlook check the sender's domain (SPF). `dbit.co.in` allows only Microsoft 365 to send its mail (`v=spf1 include:spf.protection.outlook.com -all`), so mail from `no-reply@dbit.co.in` through `mail.webuildnow.in` is accepted by our server but then rejected or dropped by Gmail. `webuildnow.in` allows this server (`v=spf1 ip4:61.12.77.22 -all`), so use a `webuildnow.in` sender. To send as `@dbit.co.in`, the college IT must add `ip4:61.12.77.22` to the `dbit.co.in` SPF record (and ideally set up DKIM), or OpenQZ must send through the college's Microsoft 365 instead.

Check a domain's SPF yourself: `nslookup -type=TXT dbit.co.in` (look for `v=spf1`).

Why not `SMTP_HOST=localhost`? The server's TLS certificate is for `mail.webuildnow.in`, so the connection fails with `certificate is not valid for 'localhost'`. `compose.mail.yaml` keeps the real name and points it at your machine instead.

### Step 4: start the stack with the mail override

```bash
docker compose -f compose.yaml -f compose.dev.yaml -f compose.mail.yaml up -d
```

Run this again (it recreates api and worker) whenever you change `.env`. To go back to Mailpit, run the normal command without `compose.mail.yaml`.

### Step 5: test

Check the connection and login from inside the api container (sends nothing):

```bash
docker compose -f compose.yaml -f compose.dev.yaml -f compose.mail.yaml exec -T api python - <<'EOF'
import asyncio, aiosmtplib
from app.core.config import get_settings
s = get_settings()
async def main():
    c = aiosmtplib.SMTP(hostname=s.smtp_host, port=s.smtp_port, start_tls=s.smtp_starttls, timeout=20)
    await c.connect(); print("starttls ok")
    await c.login(s.smtp_user, s.smtp_password); print("login ok")
    await c.quit()
asyncio.run(main())
EOF
```

Then send one real message to an inbox you own (replace the address):

```bash
docker compose -f compose.yaml -f compose.dev.yaml -f compose.mail.yaml exec -T api python - <<'EOF'
import asyncio
from app.services import email
m = email.Mail(to="you@example.com", subject="OpenQZ email test",
               text="Test from OpenQZ.", html="<p>Test from OpenQZ.</p>")
print("sent:", asyncio.run(email.send(m)))
EOF
```

`sent: True` means the server accepted it. Check the inbox and the spam folder. You can also test the real flow: sign out, press **Forgot your password?** and enter the email of a user you own.

## 3. Server with its own mail server (port 587)

When OpenQZ runs on the same machine as the mail server (for example Postfix for `mail.webuildnow.in`), no tunnel is needed: the containers talk to the host's port 587.

```mermaid
flowchart LR
    W["worker container"] -- "mail.webuildnow.in:587<br/>(extra_hosts: host-gateway)" --> H["mail server on the host<br/>port 587, STARTTLS"]
    H --> I["Gmail, Outlook, ..."]
```

Why not just use the public name? Inside Docker, `mail.webuildnow.in` resolves to the server's public IP, and many servers cannot connect back to their own public IP (no hairpin NAT), so the mail times out. `compose.mail.yaml` maps the name to the host instead, and TLS still checks the real certificate.

1. In `.env.prod` (and `.env.staging`):

   ```env
   SMTP_HOST=mail.webuildnow.in
   SMTP_PORT=587
   SMTP_USER=dbit-oscc
   SMTP_PASSWORD=<the mailbox password>
   SMTP_FROM=OpenQZ <dbit-oscc@webuildnow.in>
   SMTP_STARTTLS=true
   SMTP_SSL=false
   ```

2. Start with the mail override: `make prod-up LOCAL_MAIL=1` (and `make staging-up LOCAL_MAIL=1`). Use it on every `up`, or the containers go back to the public name.
3. On the host, the mail server must accept connections from the Docker network, not only from `127.0.0.1`:
   - Postfix: port 587 (`submission` in `master.cf`) listens on all interfaces when `inet_interfaces = all` (the usual setting for a public mail server). Check with `ss -ltnp | grep :587`: it must show `0.0.0.0:587` or the Docker bridge address, not `127.0.0.1:587`.
   - Firewall: if `ufw` is on and 587 is not open, allow the Docker networks: `sudo ufw allow from 172.16.0.0/12 to any port 587 proto tcp`.
4. Test from inside the stack (connects, checks TLS and logs in, sends nothing):

   ```bash
   docker compose -p openqz-prod exec -T worker python -c "
   import smtplib, ssl; from app.core.config import get_settings as g; s = g()
   c = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=10); c.starttls(context=ssl.create_default_context())
   print(c.login(s.smtp_user, s.smtp_password)); c.quit()"
   ```

   `(235, ...)` means it works. Then request a password reset for your own account and check it arrives.
5. Sender rule (SPF) still applies: send from `@webuildnow.in`, not `@dbit.co.in`.

## Troubleshooting

| Error | Cause and fix |
| --- | --- |
| `Timed out connecting to mail.webuildnow.in on port 587` | You are connecting to the server directly; it is not reachable from outside. Start the tunnel and use `compose.mail.yaml` with `SMTP_PORT=1587`. |
| `Connection refused` / `Network is unreachable` on 1587 | The tunnel is not running, or (Linux) it listens on `localhost` only. Start it, or use `--url 0.0.0.0:1587` on Linux. |
| `certificate is not valid for 'localhost'` (or `host.docker.internal`) | `SMTP_HOST` must be `mail.webuildnow.in`, with `compose.mail.yaml` in the command. |
| `The SMTP AUTH extension is not supported by this server` | You are talking to Mailpit with a login set, or to a server before STARTTLS. Check `SMTP_STARTTLS=true`, and that you added `compose.mail.yaml`. |
| `535 5.7.8 authentication failed` | Wrong `SMTP_USER` or `SMTP_PASSWORD`. The user is the mailbox login (for example `dbit-oscc`), not a placeholder. |
| `sent: True` (or `queued as ...`) but nothing arrives | Almost always the sender domain. With `SMTP_FROM` on `@dbit.co.in`, SPF fails (only Microsoft 365 may send for it) and Gmail drops the mail. Use a `@webuildnow.in` sender, or get `dbit.co.in`'s SPF updated. See step 3. Also check spam. |
| Changed `.env` but nothing changed | Containers read `.env` only when created. Run the `up -d` command again. |
| Production: `Timed out` or `Connection refused` to `mail.webuildnow.in:587` | The mail server is on the same machine: start with `LOCAL_MAIL=1` (section 3), and check that 587 listens on more than `127.0.0.1` and the firewall allows the Docker networks. |
| Emails in production fail | `docker compose -p openqz-prod logs worker` shows each failure with the reason. |

## Rules

- Never commit `.env` or put the SMTP password in docs, tickets or chat.
- Use the real-mail mode only for testing email itself. Run the browser tests in the default (Mailpit) mode.
- Teachers can untick "Email students" on an assignment to send nothing for it.
