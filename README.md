# More Than Just Clothing – appointment website

Public site: `index.html` · Owner page: `/owner` · Server: `netlify/functions/api.mjs`
Business settings (hours, phone, email, how far ahead people can book): `assets/config.mjs`

## One-time setup on Netlify
1. Put these files in a GitHub repository (upload the contents of this folder, keeping the folders as they are).
2. In Netlify: Add new project → Import an existing project → GitHub → pick the repository → Deploy.
   Leave the build command empty; Netlify reads netlify.toml.
3. Project configuration → Environment variables → add `OWNER_PASSWORD` with a password only you know.
   Then Deploys → Trigger deploy so it takes effect.
4. Email alerts: Forms → enable form detection, redeploy, then Forms → Form notifications → Add notification → Email.
5. Optional: Project configuration → General → change the project name (gives you name.netlify.app).

Owner page: https://YOUR-NAME.netlify.app/owner
