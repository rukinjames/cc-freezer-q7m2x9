Source for the Campus Creamery inventory app.

The site at the repo root is built from these files. To rebuild, run
`python3 build.py https://jnfksxaswtxpgsgfmpdm.supabase.co/functions/v1/inventory` inside `src/app`
and copy `site/` to the repo root.

The Square token and the shop passcode live only in Supabase Edge Function secrets
(SQUARE_ACCESS_TOKEN, INVENTORY_PASSCODE). Nothing secret belongs in this repo.
