const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STORE_FILE = path.join(ROOT, 'data', 'store.json');
const EXTRACT_SCRIPT = path.join(ROOT, 'scripts', 'extractWorkbookData.ps1');

function findWorkbookPath() {
    const files = fs.readdirSync(ROOT).filter((f) => /\.xlsx$/i.test(f));
    if (!files.length) {
        throw new Error('No .xlsx file found in project root.');
    }
    return path.join(ROOT, files[0]);
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function asNumberOrEmpty(value) {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    if (!text) return '';
    if (/^-?\d+(\.\d+)?$/.test(text)) return text;
    return '';
}

function seedFromWorkbook() {
    console.log('Finding workbook...');
    const workbookPath = findWorkbookPath();

    console.log(`Extracting data from ${workbookPath}...`);
    const output = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', EXTRACT_SCRIPT, '-WorkbookPath', workbookPath],
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );

    const extracted = JSON.parse(output);
    const prizes = [];
    let nextId = 1;

    console.log('Parsing rows...');
    for (const sheet of extracted.sheets || []) {
        const isDay = /^DAY\s*\d+/i.test(sheet.name || '');
        const isOverall = /^OVERALL$/i.test(sheet.name || '');
        const sheetKey = slugify(sheet.name);
        let currentLocation = '';
        let headerSeen = false;

        for (const row of sheet.rows || []) {
            const a = (row.a || '').trim();
            const b = (row.b || '').trim();
            const c = (row.c || '').trim();
            const d = (row.d || '').trim();
            const e = (row.e || '').trim();
            const f = (row.f || '').trim();

            if (isDay) {
                const headerLike = /^LOCAT/i.test(a.toUpperCase()) && b.toUpperCase() === 'PLACE';
                if (!headerSeen && headerLike) {
                    headerSeen = true;
                    continue;
                }
                if (!headerSeen) continue;
                if (/^SUBTOTAL\s+DAY/i.test(a)) continue;

                const isSectionHeading = a && !b && !c && !d && !e && !f;
                if (isSectionHeading) {
                    currentLocation = a;
                    continue;
                }
                if (a) currentLocation = a;

                const hasPrizeData = Boolean(b || c || d || e || f);
                if (!hasPrizeData) continue;

                prizes.push({
                    id: `P${nextId++}`,
                    sheetName: sheet.name,
                    sheetKey,
                    rowNumber: row.rowNumber,
                    location: a || currentLocation || '',
                    place: b,
                    categoryCode: c,
                    prizeValue: d,
                    prizeSponsor: e,
                    winnerTeamName: '',
                    winnerTeamNumber: f,
                    notes: '',
                    isOverall: false,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                });
                continue;
            }

            if (isOverall) {
                if (row.rowNumber < 8) continue;
                if (!a && !b && !c && !d && !e && !f) continue;

                const combined = `${a} ${b} ${c} ${d} ${e}`.trim();
                if (!combined) continue;

                const likelyNoteOnly = !b && !c && !e && d && !/\d/.test(d) && !/(courtesy|gift|total|race|team|paddler|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)/i.test(d);
                if (likelyNoteOnly) continue;

                const prizeValue = asNumberOrEmpty(c) || asNumberOrEmpty(d) || asNumberOrEmpty(b);
                const derivedSponsor = e || (!prizeValue && d ? d : '');
                const note = prizeValue && d && d !== prizeValue ? d : '';

                prizes.push({
                    id: `P${nextId++}`,
                    sheetName: sheet.name,
                    sheetKey,
                    rowNumber: row.rowNumber,
                    location: a,
                    place: b,
                    categoryCode: c && !/^\d/.test(c) ? c : '',
                    prizeValue,
                    prizeSponsor: derivedSponsor,
                    winnerTeamName: '',
                    winnerTeamNumber: f,
                    notes: note,
                    isOverall: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                });
            }
        }
    }

    return {
        metadata: {
            title: 'Belikin La Ruta Maya Belize River Challenge Prizes',
            workbookPath,
            seededAt: new Date().toISOString(),
        },
        lastId: nextId,
        prizes,
    };
}

function main() {
    try {
        const seeded = seedFromWorkbook();

        // We do NOT want to overwrite the winner names from the local store if they already exist, 
        // unless the Excel directly dictates the winners (which it doesn't currently do based on how it's parsed from the script).
        // Wait, the user wants to upload an UPDATED XLSX which might contain winners!
        // The previous implementation generated empty strings for winnerTeamName and winnerTeamNumber!

        // Wait, the parser currently reads:
        // winnerTeamName: '',
        // winnerTeamNumber: f, (Wait, f is the team number, but where is the winner name?)
        // This is how the server.js parsed it. The admin panel was where winners were typed in.

        // As we are replacing the stored JSON with the new parsed JSON, any manually entered winners via admin will be lost if not merged!
        let existingPrizes = [];
        if (fs.existsSync(STORE_FILE)) {
            try {
                const existingData = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
                existingPrizes = existingData.prizes || [];
            } catch (e) { }
        }

        // Merge existing winners back into the newly parsed rows by checking matching (location + place + categoryCode)
        console.log('Merging existing winners with updated workbook...');
        for (const prize of seeded.prizes) {
            const existingMatch = existingPrizes.find(ep =>
                ep.sheetKey === prize.sheetKey &&
                ep.location === prize.location &&
                ep.place === prize.place &&
                ep.categoryCode === prize.categoryCode
            );
            if (existingMatch) {
                if (existingMatch.winnerTeamName) prize.winnerTeamName = existingMatch.winnerTeamName;
                if (existingMatch.winnerTeamNumber && !prize.winnerTeamNumber) prize.winnerTeamNumber = existingMatch.winnerTeamNumber;
                if (existingMatch.notes && !prize.notes) prize.notes = existingMatch.notes;
            }
        }

        fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });

        const temp = `${STORE_FILE}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(seeded, null, 2), 'utf8');
        fs.renameSync(temp, STORE_FILE);
        console.log(`Successfully updated ${STORE_FILE}`);
    } catch (err) {
        console.error('Error updating data:', err.message);
        process.exit(1);
    }
}

main();
