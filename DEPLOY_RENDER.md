# Deploy On Render (Beginner Friendly)

This project is now prepared for Render using `render.yaml`.

## 1) Push code to GitHub

```bash
git add .
git commit -m "Prepare Render deployment"
git push
```

## 2) Create Render Blueprint

1. Open Render dashboard.
2. Click `New` -> `Blueprint`.
3. Connect your GitHub repo.
4. Render will detect `render.yaml` and create:
   - Web service: `simple-task-master`
   - Postgres DB: `simple-task-master-db`
5. Click `Apply`.

## 3) Run database migration once

After first deploy:

1. Open service `simple-task-master` in Render.
2. Go to `Shell`.
3. Run:

```bash
npm run db:push
```

## 4) Verify deployment

- Open your Render app URL.
- Health check endpoint should return JSON:
  - `/api/health`

## Notes

- WebSocket chat/call signaling is supported on Render web services.
- For stable voice calls across different networks, add TURN server later.
