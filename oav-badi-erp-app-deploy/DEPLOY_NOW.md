# Deploy OAV BADI ERP

## Upload To GitHub

1. Open https://github.com/new
2. Repository name: `oav-badi-erp`
3. Keep it private or public.
4. Upload all files from this folder.

## Deploy On Render

1. Open https://dashboard.render.com
2. Click `New +`
3. Select `Web Service`
4. Connect GitHub repository `oav-badi-erp`
5. Set:
   - Runtime: Node
   - Build Command: leave blank or use `npm install`
   - Start Command: `node server.js`
6. Add environment variable:
   - Key: `OAV_DB_FILE`
   - Value: `/var/data/db.json`
7. Add persistent disk:
   - Name: `oav-badi-data`
   - Mount Path: `/var/data`
   - Size: `1 GB`
8. Click `Deploy Web Service`

After deploy, Render will show a public URL. Share that URL with teachers.

## Login/Teacher Use

Open the public URL, then select teacher from `Use As`.
Teacher class is locked based on `Assigned Class`, for example `VI-A`.
