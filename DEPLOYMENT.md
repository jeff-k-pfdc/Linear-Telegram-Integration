# Deploying a Node.js App to DigitalOcean

A step-by-step guide for deploying any Node.js app to a DigitalOcean droplet with automatic GitHub deploys and HTTPS.

---

## What you'll set up

- **DigitalOcean Droplet** — the server that runs your app
- **PM2** — keeps your app running and restarts it on crashes/reboots
- **nginx** — handles HTTPS and forwards traffic to your app
- **Cloudflare DNS** — points your subdomain to the droplet
- **Let's Encrypt** — free SSL certificate
- **GitHub Actions** — automatically deploys on every push to main

---

## Step 1 — Create the Droplet

1. Go to [DigitalOcean](https://cloud.digitalocean.com) → **Create → Droplets**
2. Choose:
   - Image: **Ubuntu 22.04 LTS**
   - Plan: **Basic → $6/month** (1GB RAM, 1 CPU)
   - Datacenter: pick closest to your users
3. Under **Authentication** → **SSH Key** → **Add SSH Key**
   - On your local machine run: `cat ~/.ssh/id_ed25519.pub`
   - Paste the output into DigitalOcean
   - If you don't have a key yet: `ssh-keygen -t ed25519` then run the above
4. Give the droplet a name (e.g. `my-app-bot`)
5. Click **Create Droplet** — note the **IP address**

---

## Step 2 — SSH into the Droplet

From your local machine:

```bash
ssh root@YOUR_DROPLET_IP
```

Type `yes` when asked about authenticity. You're now controlling the server remotely.

---

## Step 3 — Install Node.js, PM2, and nginx

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs nginx
npm install -g pm2@latest
apt autoremove -y
```

Verify:
```bash
node --version   # should show v22.x.x
pm2 --version
nginx -v
```

---

## Step 4 — Clone your repo and install dependencies

```bash
mkdir -p /opt/your-app-name
cd /opt/your-app-name
git clone https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git .
npm install --production
```

---

## Step 5 — Create the .env file

```bash
nano /opt/your-app-name/.env
```

Paste in all your environment variables. `Ctrl+X` → `Y` → Enter to save.

Any other config files your app needs (e.g. `user-map.json`, `groups.json`) also need to be created manually here since they are gitignored.

---

## Step 6 — Start the app with PM2

```bash
pm2 start src/index.js --name your-app-name
pm2 save
pm2 startup
```

Run the command that `pm2 startup` outputs, then run `pm2 save` again.

Useful PM2 commands:
```bash
pm2 status                        # see all running apps
pm2 logs your-app-name            # live logs
pm2 restart your-app-name         # restart
pm2 stop your-app-name            # stop
```

---

## Step 7 — Add a DNS record in Cloudflare

1. Go to Cloudflare → your domain → **DNS → Add record**
2. Type: **A**
3. Name: `your-subdomain` (e.g. `my-app` → creates `my-app.pf-internal.com`)
4. IPv4 address: your droplet's IP
5. Proxy status: **DNS only** (grey cloud — NOT proxied)
6. TTL: Auto

Test propagation from your local machine:
```bash
nslookup your-subdomain.pf-internal.com 8.8.8.8
```

Should return your droplet IP. Wait a few minutes if it doesn't.

---

## Step 8 — Configure nginx

```bash
nano /etc/nginx/sites-available/your-app-name
```

Paste (replace the domain and port):
```nginx
server {
    listen 80;
    server_name your-subdomain.pf-internal.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable it:
```bash
ln -s /etc/nginx/sites-available/your-app-name /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

---

## Step 9 — Get a free SSL certificate

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-subdomain.pf-internal.com
```

Follow the prompts (enter email, agree to terms). Certbot automatically updates your nginx config for HTTPS.

Test:
```bash
nginx -t && systemctl reload nginx
curl https://your-subdomain.pf-internal.com/health
```

Your app is now live at `https://your-subdomain.pf-internal.com`.

---

## Step 10 — Set up GitHub Actions for auto-deploy

### Generate a deploy SSH key (do this on the droplet)

```bash
ssh-keygen -t ed25519 -C "github-deploy" -f /root/.ssh/github_deploy -N ""
cat /root/.ssh/github_deploy.pub >> /root/.ssh/authorized_keys
cat /root/.ssh/github_deploy
```

Copy the full private key output.

### Add GitHub Secrets

Go to your GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**

Add:
- `DROPLET_IP` = your droplet's IP address
- `SSH_PRIVATE_KEY` = the private key you just copied (full content including BEGIN/END lines)

### Create the workflow file

Create `.github/workflows/deploy.yml` in your repo:

```yaml
name: Deploy to DigitalOcean

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Deploy to droplet
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.DROPLET_IP }}
          username: root
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/your-app-name
            git pull origin main
            npm install --production
            pm2 restart your-app-name
```

Commit and push — GitHub Actions will now automatically deploy every time you push to `main`.

---

## Running multiple apps on the same droplet

Each app needs its own:
- **Port** (3000, 3001, 3002, etc.)
- **PM2 process name**
- **nginx config file** (in `/etc/nginx/sites-available/`)
- **Subdomain** (e.g. `app1.pf-internal.com`, `app2.pf-internal.com`)

Everything else (Node.js, PM2, nginx, certbot) is already installed and shared.

---

## Useful commands reference

```bash
# App management
pm2 status                        # all running apps
pm2 logs app-name                 # live logs
pm2 restart app-name              # restart app
pm2 reload app-name               # zero-downtime restart

# nginx
nginx -t                          # test config
systemctl reload nginx            # apply config changes
cat /var/log/nginx/error.log      # nginx errors

# SSL renewal (auto, but manual if needed)
certbot renew --dry-run

# Droplet resource usage
htop                              # CPU/memory live view
df -h                             # disk usage
```
