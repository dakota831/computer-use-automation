# Deployment

The reference deployment is a single small VM. Everything binds to loopback and nginx
is the only thing listening publicly.

| Name | Serves | Auth |
|---|---|---|
| `teller.dexdash.cloud` | the synthetic target app (`127.0.0.1:8080`) | open |
| `console.dexdash.cloud` | operator console (static build + `/api`, `/ws` proxy) | HTTP basic |
| `api.dexdash.cloud` | capability catalog / replay API (`127.0.0.1:4000`) | HTTP basic |

The teller app is open because every byte of its data is fabricated and it is meant to
be clicked around. The console and API are not: the console can take control of a live
browser session, and an unauthenticated remote-control endpoint on a public hostname is
a genuine hole, not a theoretical one.

Basic auth is the floor, not the answer. A real deployment puts these behind the
institution's SSO with per-operator identity, because "who took control of this session"
has to be a named person for the audit trail to mean anything.

- `nginx/dex-apps.conf` -> `/etc/nginx/sites-available/dex-apps`
- `systemd/dex-target.service` -> `/etc/systemd/system/dex-target.service`

TLS is a single Let's Encrypt certificate covering all names, renewed by the certbot
timer. Credentials live in `.env` (chmod 600, gitignored) and in an nginx htpasswd file;
neither is in this repository.
