# OAV BADI ERP - Render Online Deploy

## Ready Files

- Main online page: `outputs/index.html`
- Latest editable app file: `outputs/oav-badi-attendance-erp-mdm-updated.html`
- Render config: `render.yaml`

## Deploy Steps

1. Open GitHub and create/upload this project repository.
2. Make sure these files are uploaded:
   - `render.yaml`
   - full `outputs` folder
   - especially `outputs/index.html`
3. Open Render.
4. Choose **New +** > **Blueprint**.
5. Connect the GitHub repository.
6. Render will read `render.yaml`.
7. Click **Apply** / **Deploy**.
8. After deploy, open the Render URL.

## If Blueprint Deploy Fails

Use the simpler manual static-site method:

1. Render dashboard me **New +** > **Static Site** select karo.
2. GitHub repository select karo.
3. Settings me ye values rakho:
   - Name: `oav-badi-attendance-erp`
   - Branch: `main`
   - Build Command: `echo "Static HTML app - no build required"`
   - Publish Directory: `outputs`
4. Create Static Site / Deploy click karo.

Manual method me `render.yaml` zaruri nahi hota, lekin `outputs/index.html` GitHub repo me hona must hai.

## Important Note

This version is a static browser app. It works online, but data is stored in each browser's local storage. If Admin, Principal, and Teachers need to share the same live data from mobile/computer, the next phase must add a backend database.

Recommended next phase:

- Frontend: current ERP UI
- Backend: Node.js/Express
- Database: PostgreSQL on Render
- Login/session security
- Shared student, teacher, attendance, MDM, reports data

## Mobile Use

After Render deploy, open the Render URL on mobile Chrome. Add it to home screen:

1. Open the ERP URL.
2. Tap browser menu.
3. Tap **Add to Home screen**.
4. Open it like an app.
