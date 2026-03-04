---
description: Update winners from a new XLSX file
---

This workflow updates the live Station Prizes board with new data whenever a new version of the `.xlsx` Excel file is placed into the project folder. 

When you get a new `.xlsx` file from the race coordinators, just put it into the project folder replacing the old one, and then ask me to run this workflow!

// turbo-all
1. Parse the new Excel file and update the `data/store.json` database without losing any manually-assigned winners from the admin panel
`npm run update-data`

2. Commit the new `.xlsx` file and the updated `store.json` database to GitHub
`git add *.xlsx data/store.json package.json scripts/update-data.js; git commit -m "chore: upload new XLSX file and update data store" ; git push`
