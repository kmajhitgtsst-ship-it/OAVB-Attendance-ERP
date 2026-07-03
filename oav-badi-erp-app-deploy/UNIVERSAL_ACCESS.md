# OAV BADI ERP - Universal Access

Localhost and Wi-Fi IP work only inside the same network. For universal access from any mobile, deploy this app to a public server.

## Option 1: Render

1. Create a GitHub repository and upload this `oav-badi-erp-app` folder.
2. Go to Render and create a new Web Service from that repository.
3. Use:
   - Runtime: Node
   - Start command: `node server.js`
   - Environment variable: `OAV_DB_FILE=/var/data/db.json`
4. Add a persistent disk:
   - Mount path: `/var/data`
   - Size: 1 GB or more
5. Deploy.

After deploy, Render gives a public URL like:

```text
https://oav-badi-erp.onrender.com
```

Teachers can open that URL from any mobile internet connection.

## Option 2: VPS / School Server

Run:

```bash
node server.js
```

Use a domain or public IP with firewall port open. For production, place Nginx/Caddy in front with HTTPS.

## Important

- Do not use a downloaded HTML file on mobile.
- Open the public URL in Chrome.
- For real school deployment, add password/OTP login before sharing outside staff.
