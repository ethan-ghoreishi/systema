/**
 * systema-sheet-sync
 *
 * A container-bound Apps Script for the dedicated capture spreadsheet ONLY.
 * It appends expense rows to that sheet and does nothing else — there is no
 * DriveApp usage and no access to any other file. It can never touch your
 * master "Tax and Source of Income" workbook.
 *
 * Deploy steps are in docs/apps-script-setup.md.
 */

// Optional shared secret. Leave '' to disable, or set a string and enter the
// same value in systema → Settings → Capture sync → Shared token.
var SHARED_TOKEN = '';

// The tab to append to. Falls back to the active sheet if not found.
var SHEET_NAME = 'Travel Spending';

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'No request body' });
    }

    var body = JSON.parse(e.postData.contents);

    if (SHARED_TOKEN && body.token !== SHARED_TOKEN) {
      return json({ ok: false, error: 'Unauthorized' });
    }

    var rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) {
      return json({ ok: true, appended: 0 });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.getActiveSheet();

    for (var i = 0; i < rows.length; i++) {
      sheet.appendRow(rows[i]);
    }

    return json({ ok: true, appended: rows.length });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// A simple health check so visiting the /exec URL in a browser confirms it works.
function doGet() {
  return json({ ok: true, service: 'systema-sheet-sync' });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
