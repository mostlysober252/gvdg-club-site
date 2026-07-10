// --- Small, robust CSV parser -------------------------------------------------
// Handles quoted fields, embedded commas, escaped quotes ("") and CRLF/CR/LF
// line endings. Returns an array of rows, each an array of string cells.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      // handle CRLF and lone CR
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }

    field += c;
    i += 1;
  }

  // flush trailing field/row (unless the text ended on a newline with nothing after)
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// --- Helpers ------------------------------------------------------------------
const cellText = (row, idx) => {
  const v = row && idx < row.length ? row[idx] : '';
  return v && typeof v === 'object' ? String(v.text || '') : String(v == null ? '' : v);
};
const cellFill = (row, idx) => {
  const v = row && idx < row.length ? row[idx] : '';
  return v && typeof v === 'object' ? String(v.fill || '').toUpperCase() : '';
};
const norm = (s) => String(s == null ? '' : s).trim();
const isWinnerFill = (fill) => fill === 'FF00FF00' || fill === '00FF00';
const DOUBLES_WEEKS = new Set([2, 3, 5, 6, 8]);

export function ryderWeekFormat(label) {
  const match = norm(label).match(/^week\s+(\d+)/i);
  if (!match) return 'singles';
  return DOUBLES_WEEKS.has(parseInt(match[1], 10)) ? 'doubles' : 'singles';
}

function seedPairForMatch(num) {
  const first = (num - 1) * 2 + 1;
  return [first, first + 1];
}

export function seedPairNames(players, seeds) {
  return (Array.isArray(seeds) ? seeds : []).map((seed) => {
    const player = Array.isArray(players) ? norm(players[seed - 1]) : '';
    return player || `Seed ${seed}`;
  });
}

// "A&B": A = holes the leader was up, B = holes remaining. The sheet does NOT encode
// WHICH team (Red/Blue) won in the visible cells, so a match winner cannot be derived
// from the score alone. We only recognise an explicit tie (or "0&B"); otherwise the
// winner is unknown (null). Team totals come from the sheet's official "Points Scored"
// row, never re-derived from per-match scores.
function winnerFromScore(rawScore) {
  const s = norm(rawScore).toLowerCase();
  if (!s) return null; // unplayed
  if (s === 'tie' || s === 'as' || s === 'halved' || s === 'a/s' || /^tie\b/.test(s)) return 'tie';
  const m = s.match(/^(\d+)\s*&\s*(\d+)$/);
  if (m && parseInt(m[1], 10) === 0) return 'tie';
  return null; // played, but the winning color is not derivable from the sheet
}

function winnerFromCells(rawScore, redFill, blueFill) {
  const redWins = isWinnerFill(redFill);
  const blueWins = isWinnerFill(blueFill);
  if (redWins && !blueWins) return 'red';
  if (blueWins && !redWins) return 'blue';
  return winnerFromScore(rawScore);
}

function playerCell(rawValue) {
  const value = norm(rawValue);
  return value && !/^\d+$/.test(value) ? value : '';
}

// Locate the week-group columns by scanning the "Match-ups" header row for the
// repeating Red / Blue / (optional) Score sub-columns. Returns one descriptor
// per week: { redCol, blueCol, scoreCol|null }. This walks the wide grid and
// naturally skips the empty spacer columns between week groups, and tolerates
// weeks that have no Score sub-column yet (later, not-yet-played weeks).
function findWeekColumns(matchupRow) {
  const groups = [];
  for (let c = 0; c < matchupRow.length; c++) {
    if (norm(cellText(matchupRow, c)).toLowerCase() !== 'red') continue;
    const redCol = c;
    const blueCol = c + 1; // Blue always immediately follows Red
    const scoreCol =
      norm(cellText(matchupRow, c + 2)).toLowerCase() === 'score' ? c + 2 : null;
    groups.push({ redCol, blueCol, scoreCol });
  }
  return groups;
}

// Pair each week-column group with its label from the week-header row and its
// date from the "Dates" row. The label/date for a group is the nearest non-empty
// header cell at-or-before that group's Red column (labels sit one column left of
// the Red sub-column, e.g. "Week 1" header in col 1, Red in col 2).
function labelForColumn(headerRow, col) {
  for (let c = col; c >= 0; c--) {
    const v = norm(cellText(headerRow, c));
    if (v) return { label: v, col: c };
  }
  return { label: '', col: -1 };
}

/**
 * Parse the wide weekly match grid CSV.
 * @param {string} csvText
 * @returns {{ weeks: Array<{label:string, dates:string, format:'singles'|'doubles', matches:Array<{num:number, red:string, blue:string, score:string, winner:('red'|'blue'|'tie'|null), seeds?:number[]}>}>, teamPoints:{red:number, blue:number} }}
 */
export function parseMatchGrid(csvText) {
  return parseMatchGridRows(parseCsv(csvText));
}

export function parseMatchGridRows(rows) {
  // Identify the structural rows by their first-cell labels.
  const headerRow = rows[0] || [];
  const datesRow = rows.find((r) => norm(cellText(r, 0)).toLowerCase() === 'dates') || [];
  const matchupRowIdx = rows.findIndex(
    (r) => norm(cellText(r, 0)).toLowerCase() === 'match-ups'
  );
  const matchupRow = matchupRowIdx >= 0 ? rows[matchupRowIdx] : [];

  const groups = findWeekColumns(matchupRow);

  // The numbered matchup rows live between the Match-ups row and the
  // "Points Scored" / totals rows. A data row is identified by a numeric value
  // in the matchup-number column (col 1 in this sheet — the cell to the left of
  // Week 1's Red column / under the Week-1 header).
  const numCol = groups.length ? groups[0].redCol - 1 : 1;

  const stopLabels = new Set([
    'points scored',
    'total points',
    'red home',
    'blue home',
    'winner',
    'tie',
  ]);

  const dataRows = [];
  if (matchupRowIdx >= 0) {
    for (let r = matchupRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const first = norm(cellText(row, 0)).toLowerCase();
      if (stopLabels.has(first)) break; // reached the totals block
      const numRaw = norm(cellText(row, numCol));
      if (!/^\d+$/.test(numRaw)) continue; // spacer / blank row
      dataRows.push(row);
    }
  }

  // Official team points come from the sheet's "Points Scored" row — the per-week
  // Red/Blue totals sit in that row at each week group's Red/Blue columns. We never
  // re-derive totals from the A&B scores (which don't say which color won).
  const pointsRow = rows.find((r) => norm(cellText(r, 0)).toLowerCase() === 'points scored') || [];
  const toInt = (v) => {
    const n = parseInt(norm(v), 10);
    return Number.isNaN(n) ? 0 : n;
  };

  const teamPoints = { red: 0, blue: 0 };
  for (const g of groups) {
    teamPoints.red += toInt(cellText(pointsRow, g.redCol));
    teamPoints.blue += toInt(cellText(pointsRow, g.blueCol));
  }

  const weeks = groups.map(({ redCol, blueCol, scoreCol }) => {
    const { label, col: labelCol } = labelForColumn(headerRow, redCol);
    const dates = norm(cellText(datesRow, labelCol >= 0 ? labelCol : redCol));
    const format = ryderWeekFormat(label);

    const singlesMatches = () => dataRows.map((row) => {
      const num = parseInt(norm(cellText(row, numCol)), 10);
      const red = norm(cellText(row, redCol));
      const blue = norm(cellText(row, blueCol));
      const score = scoreCol != null ? norm(cellText(row, scoreCol)) : '';
      return {
        num,
        red,
        blue,
        score,
        winner: winnerFromCells(score, cellFill(row, redCol), cellFill(row, blueCol)),
      };
    });

    const doublesMatches = () => {
      const matches = new Map();
      const matchSlot = (num) => {
        let match = matches.get(num);
        if (!match) {
          match = {
            num,
            redPlayers: [],
            bluePlayers: [],
            score: '',
            winner: null,
            seeds: seedPairForMatch(num),
          };
          matches.set(num, match);
        }
        return match;
      };

      for (const row of dataRows) {
        const rowSeed = parseInt(norm(cellText(row, numCol)), 10);
        const num = Number.isInteger(rowSeed) ? Math.ceil(rowSeed / 2) : null;
        if (!Number.isInteger(num) || num < 1 || num > 6) continue;
        const match = matchSlot(num);
        const red = playerCell(cellText(row, redCol));
        const blue = playerCell(cellText(row, blueCol));
        if (red) match.redPlayers.push(red);
        if (blue) match.bluePlayers.push(blue);
        const score = scoreCol != null ? norm(cellText(row, scoreCol)) : '';
        if (score && !match.score) match.score = score;
        const winner = winnerFromCells(score, cellFill(row, redCol), cellFill(row, blueCol));
        if (winner && !match.winner) match.winner = winner;
      }
      return [...matches.values()].map((match) => ({
        ...match,
        red: match.redPlayers.join(' / '),
        blue: match.bluePlayers.join(' / '),
      })).sort((a, b) => a.num - b.num);
    };

    return { label, dates, format, matches: format === 'doubles' ? doublesMatches() : singlesMatches() };
  });

  return { weeks, teamPoints };
}

/**
 * Parse the scoreboard CSV (team names + rosters).
 * Layout: a header row "SCORE BOARD <Red team> ... <Blue team> ..."; then numbered
 * roster rows where the Red roster sits in the first columns and the Blue roster
 * in a later column block. We locate the two team-name anchors on the header row
 * and read each roster column directly to its right.
 * @param {string} csvText
 * @returns {{ red:{name:string, players:string[]}, blue:{name:string, players:string[]} }}
 */
export function parseScoreboard(csvText) {
  return parseScoreboardRows(parseCsv(csvText));
}

export function parseScoreboardRows(rows) {
  const headerIdx = rows.findIndex((row) => /^score\s*board/i.test(norm(cellText(row, 0))));
  if (headerIdx > 0) rows = rows.slice(headerIdx);
  if (/^score\s*board$/i.test(norm(cellText(rows[0] || [], 0))) && rows.length > 1) rows = rows.slice(1);
  if (!rows.length) {
    return { red: { name: 'Red', players: [] }, blue: { name: 'Blue', players: [] } };
  }

  const header = rows[0];

  // Red team name is in the first header cell, e.g. "SCORE BOARD Juan Team".
  let redName = norm(cellText(header, 0)).replace(/^score\s*board\s*/i, '').trim() || 'Red';

  // Blue team name is the next header cell that ends in "Team" (or the first
  // non-empty cell after a gap). Track its column so we can read the Blue roster.
  let blueNameCol = -1;
  let blueName = 'Blue';
  for (let c = 1; c < header.length; c++) {
    const v = norm(cellText(header, c));
    if (!v) continue;
    if (/team$/i.test(v)) {
      blueName = v;
      blueNameCol = c;
      break;
    }
  }
  // Fallback: if no "...Team" cell, take the first non-empty header cell after
  // the leading red-stats block (Wins/Losses/Ties/Points columns).
  if (blueNameCol === -1) {
    for (let c = 1; c < header.length; c++) {
      const v = norm(cellText(header, c)).toLowerCase();
      if (v && !['wins', 'losses', 'ties', 'points', 'total'].includes(v)) {
        blueName = norm(cellText(header, c));
        blueNameCol = c;
        break;
      }
    }
  }

  // Roster layout (confirmed from fixture): Red roster name is in col 1 (the
  // cell right of the "#" index col 0). Blue roster name sits one column right of
  // the Blue team-name anchor (the Blue "#" index is at blueNameCol, the name at
  // blueNameCol + 1).
  const redNameCol = 1;
  const blueRosterCol = blueNameCol >= 0 ? blueNameCol + 1 : -1;

  const redPlayers = [];
  const bluePlayers = [];
  const stopFirst = new Set(['', 'total']);

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const idx = norm(cellText(row, 0)).toLowerCase();
    if (stopFirst.has(idx)) continue; // skip the trailing "Total" / blank row

    const redP = norm(cellText(row, redNameCol));
    if (redP) redPlayers.push(redP);

    if (blueRosterCol >= 0) {
      const blueP = norm(cellText(row, blueRosterCol));
      if (blueP) bluePlayers.push(blueP);
    }
  }

  return {
    red: { name: redName, players: redPlayers },
    blue: { name: blueName, players: bluePlayers },
  };
}

const decoder = new TextDecoder();

function xmlDecode(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function attr(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`${escaped}="([^"]*)"`));
  return match ? xmlDecode(match[1]) : '';
}

function xmlBlock(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`));
  return match ? match[1] : '';
}

function parseSharedStrings(xml) {
  const out = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    let text = '';
    for (const t of match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
      text += xmlDecode(t[1]);
    }
    out.push(text);
  }
  return out;
}

function parseStyles(xml) {
  const fills = [];
  for (const fill of xmlBlock(xml, 'fills').matchAll(/<fill\b[^>]*>([\s\S]*?)<\/fill>/g)) {
    const fg = fill[1].match(/<fgColor\b([^>]*)\/>/);
    fills.push(fg ? attr(fg[1], 'rgb').toUpperCase() : '');
  }

  const xfs = [];
  for (const xf of xmlBlock(xml, 'cellXfs').matchAll(/<xf\b([^>]*)\/?>/g)) {
    xfs.push({
      fill: fills[parseInt(attr(xf[1], 'fillId') || '0', 10)] || '',
      numFmtId: attr(xf[1], 'numFmtId') || '0',
    });
  }
  return { xfs };
}

function colToIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function excelDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return String(serial);
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function formatCellValue(raw, type, style, sharedStrings) {
  if (type === 's') return sharedStrings[parseInt(raw || '0', 10)] || '';
  if (style && style.numFmtId === '164') return excelDate(raw);
  const n = Number(raw);
  if (raw !== '' && Number.isFinite(n) && Number.isInteger(n)) return String(n);
  return raw || '';
}

function parseWorksheetRows(xml, sharedStrings, styles) {
  const rows = [];
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ctag = match[1];
    const body = match[2] || '';
    const ref = attr(ctag, 'r');
    const refMatch = ref.match(/^([A-Z]+)(\d+)$/);
    if (!refMatch) continue;

    const col = colToIndex(refMatch[1]);
    const rowIdx = parseInt(refMatch[2], 10) - 1;
    const style = styles.xfs[parseInt(attr(ctag, 's') || '0', 10)] || { fill: '', numFmtId: '0' };
    const type = attr(ctag, 't');
    const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
    let text = valueMatch ? formatCellValue(xmlDecode(valueMatch[1]), type, style, sharedStrings) : '';
    if (!text && type === 'inlineStr') {
      text = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlDecode(t[1])).join('');
    }

    if (!rows[rowIdx]) rows[rowIdx] = [];
    rows[rowIdx][col] = { text, fill: style.fill };
  }
  return rows.map((row) => row || []);
}

function parseWorkbookSheets(workbookXml, relsXml) {
  const rels = new Map();
  for (const rel of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    rels.set(attr(rel[1], 'Id'), attr(rel[1], 'Target'));
  }

  const sheets = [];
  for (const sheet of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const target = rels.get(attr(sheet[1], 'r:id')) || '';
    sheets.push({
      name: attr(sheet[1], 'name'),
      path: target.startsWith('xl/') ? target : `xl/${target}`,
    });
  }
  return sheets;
}

function findEndOfCentralDirectory(view) {
  const min = Math.max(0, view.byteLength - 66000);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error('xlsx_zip_eocd_missing');
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('deflate_not_supported');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipEntries(arrayBuffer) {
  const buffer = arrayBuffer instanceof ArrayBuffer
    ? arrayBuffer
    : arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength);
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const out = new Map();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error('xlsx_zip_cd_invalid');
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, ptr + 46, nameLen));

    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = new Uint8Array(buffer, dataStart, compressedSize);

    let bytes;
    if (method === 0) bytes = compressed;
    else if (method === 8) bytes = await inflateRaw(compressed);
    else throw new Error(`xlsx_zip_method_${method}`);
    out.set(name, decoder.decode(bytes));

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return out;
}

export async function parseRyderWorkbook(arrayBuffer) {
  const entries = await unzipEntries(arrayBuffer);
  const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml') || '');
  const styles = parseStyles(entries.get('xl/styles.xml') || '');
  const sheets = parseWorkbookSheets(
    entries.get('xl/workbook.xml') || '',
    entries.get('xl/_rels/workbook.xml.rels') || ''
  );

  const schedule = sheets.find((s) => s.name.toLowerCase() === 'schedule') || sheets[0];
  const scoreboard = sheets.find((s) => s.name.toLowerCase() === 'scoreboard') || sheets[1];
  if (!schedule || !scoreboard) throw new Error('xlsx_expected_sheets_missing');

  const scheduleRows = parseWorksheetRows(entries.get(schedule.path) || '', sharedStrings, styles);
  const scoreboardRows = parseWorksheetRows(entries.get(scoreboard.path) || '', sharedStrings, styles);
  return {
    ...parseMatchGridRows(scheduleRows),
    scoreboard: parseScoreboardRows(scoreboardRows),
  };
}
