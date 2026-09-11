# Namecheap deployment — server-side files (not managed by CI/CD)

`deploy-namecheap.yml` (in `.github/workflows/`) auto-deploys the built
frontend (`dist/`) to `public_html` on every push to `main`. It never
touches the files below — they're part of the server's own configuration,
not the frontend build, and were set up once by hand in cPanel File
Manager. This folder just keeps an accurate copy for reference/disaster
recovery; the files here are NOT automatically synced anywhere.

## `.htaccess` (goes in `public_html/.htaccess`)

Routes `/api/*` to `api-proxy.php` (a same-origin reverse proxy to the
Render backend — see `../../api-proxy.php`), and falls back to `index.html`
for client-side routing on everything else.

## `.user.ini` (goes in `public_html/.user.ini`)

Sets `enable_post_data_reading=0` so `api-proxy.php` can read the exact raw
request body via `php://input` for every content type, including
multipart/form-data file uploads (PHP normally consumes and parses
multipart bodies automatically, making `php://input` empty for them).
Takes a few minutes to take effect after being changed (PHP caches
`.user.ini` files).

If either of these ever needs to be recreated from scratch (new hosting
account, accidental deletion), copy the matching file below into
`public_html` via cPanel File Manager.
