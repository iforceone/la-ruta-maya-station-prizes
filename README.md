# La Ruta Maya Prize App

This app converts the workbook into an easy-to-read web board and includes a secure admin backend to update winners and manage prize records.

## What it includes

- Public view (`/`): Day 1, Day 2, Day 3, Day 4, and Overall prize tables.
- Admin view (`/admin`):
  - Login with hashed password verification (PBKDF2).
  - Update winners, sponsors, and prize fields.
  - Add new station prizes or overall prizes.
  - Delete prize records.
- Data seed: first startup auto-imports from the local `.xlsx` workbook in this folder.

## Prerequisites

- Windows with PowerShell
- Node.js 18+

## Setup

1. Initialize admin user:

```powershell
npm run init-admin -- --username admin --password "Use-A-Strong-Password-Here"
```

2. Start the server:

```powershell
npm start
```

3. Open:
- Public board: http://localhost:3000/
- Admin: http://localhost:3000/admin

## Build for SiteGround (Static Hosting)

SiteGround shared hosting serves static/PHP sites, but does not run this Node.js backend directly.

To deploy the public prize board there:

1. Build static files:

```powershell
npm run build
```

2. Upload contents of `dist/` to your SiteGround `public_html` folder.

This static export includes:
- `index.html`
- `styles.css`
- `app.js`
- `data.json` (all sheet/prize data)

Notes:
- The public board works on SiteGround from `data.json`.
- Admin login/backend routes (`/admin`, `/api/...`) require Node and will not run on standard SiteGround shared hosting.
- Continue doing admin updates locally, then re-run `npm run build` and re-upload `dist` after updates.

## Deploy on Vercel (Static Public Board)

This repository is now configured for Vercel static deployment using `vercel.json`.

1. Push this project to GitHub.
2. In Vercel, click **Add New Project** and import the repo.
3. Keep defaults (Vercel reads `vercel.json`):
   - Build command: `npm run build`
   - Output directory: `dist`
4. Deploy.

After deploy, Vercel hosts the public board (`index.html`, `app.js`, `styles.css`, `data.json`).

Important:
- This static deploy does not run the Node admin backend.
- To publish updated winners/prizes, update locally via admin, run `npm run build`, commit, and push to trigger redeploy.

## Security notes

- Admin password is stored as PBKDF2 hash + salt (`data/admin.json`).
- Auth uses signed, HttpOnly session cookies.
- CSRF token is required for all admin write operations.
- For production, set a strong app secret:

```powershell
$env:APP_SECRET="replace-with-long-random-secret"
npm start
```

- If hosting behind HTTPS, set:

```powershell
$env:COOKIE_SECURE="true"
npm start
```

## Data files

- `data/store.json`: prize records and winner updates.
- `data/admin.json`: admin account.

`store.json` is created automatically on first run by importing the workbook using `scripts/extractWorkbookData.ps1`.
