<?php
/**
 * systema backup receiver — runs on the Synology (Web Station + PHP).
 *
 * Accepts two kinds of POST from the systema PWA and writes ONLY inside its
 * own backup folder next to this file:
 *   ?kind=data   body = full JSON snapshot  -> systema-backups/data/…json
 *   ?kind=photo  body = one image blob      -> systema-backups/photos/<id>.<ext>
 *
 * Photos are idempotent (same id never written twice). Data snapshots are
 * pruned to the most recent $KEEP_DATA files plus the newest one of each of
 * the last $KEEP_DAYS days, so older states stay recoverable. Every file is
 * written to a temporary name and renamed into place, so a half-written file
 * is never served. Nothing is ever read or deleted outside this folder.
 *
 * SETUP: set $TOKEN to a long random string, and enter the same value in
 * systema -> Settings -> NAS backup vault. See docs/nas-backup-setup.md.
 */

$TOKEN = 'CHANGE-ME-to-a-long-random-string';
$KEEP_DATA = 60; // most recent data snapshots to keep
$KEEP_DAYS = 90; // plus the newest snapshot of each of this many days
$BASE = __DIR__ . '/systema-backups';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { // CORS preflight
  http_response_code(204);
  exit;
}

/** Write via a temporary file and rename: readers never see a partial file. */
function write_atomic($file, $body) {
  $tmp = $file . '.tmp';
  return file_put_contents($tmp, $body) !== false && rename($tmp, $file);
}

function reply($code, $payload) {
  http_response_code($code);
  echo json_encode($payload);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  $kind = $_GET['kind'] ?? '';
  if ($kind === '') {
    reply(200, ['ok' => true, 'service' => 'systema-backup']);
  }
  if ($TOKEN === '' || ($_GET['token'] ?? '') !== $TOKEN) {
    reply(403, ['ok' => false, 'error' => 'bad token']);
  }

  // Newest data snapshot — how a fresh install restores everything.
  if ($kind === 'latest') {
    $files = glob($BASE . '/data/systema-data-*.json');
    if (!$files) {
      reply(404, ['ok' => false, 'error' => 'no snapshots yet']);
    }
    sort($files);
    readfile(end($files));
    exit;
  }

  // One photo by id, so restores can re-fetch images pushed earlier.
  if ($kind === 'photo') {
    $id = $_GET['id'] ?? '';
    if (!preg_match('/^[a-zA-Z0-9-]{8,64}$/', $id)) {
      reply(400, ['ok' => false, 'error' => 'bad id']);
    }
    $matches = glob($BASE . '/photos/' . $id . '.*');
    if (!$matches) {
      reply(404, ['ok' => false, 'error' => 'not found']);
    }
    $file = $matches[0];
    $ext = pathinfo($file, PATHINFO_EXTENSION);
    $types = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
    header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
    readfile($file);
    exit;
  }

  reply(400, ['ok' => false, 'error' => 'unknown kind']);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  reply(405, ['ok' => false, 'error' => 'POST only']);
}
if ($TOKEN === '' || ($_GET['token'] ?? '') !== $TOKEN) {
  reply(403, ['ok' => false, 'error' => 'bad token']);
}

$kind = $_GET['kind'] ?? '';
$body = file_get_contents('php://input');
if ($body === false || strlen($body) === 0) {
  reply(400, ['ok' => false, 'error' => 'empty body']);
}

@mkdir($BASE . '/data', 0770, true);
@mkdir($BASE . '/photos', 0770, true);

if ($kind === 'data') {
  if (json_decode($body) === null) {
    reply(400, ['ok' => false, 'error' => 'not JSON']);
  }
  // Microseconds keep two devices pushing in the same second from overwriting
  // each other; names still sort chronologically.
  $micro = (int) (fmod(microtime(true), 1) * 1000000);
  $file = $BASE . '/data/systema-data-' . date('Ymd-His') . sprintf('-%06d', $micro) . '.json';
  if (!write_atomic($file, $body)) {
    reply(500, ['ok' => false, 'error' => 'write failed']);
  }
  // Prune: keep the newest $KEEP_DATA, plus the newest of each recent day.
  $files = glob($BASE . '/data/systema-data-*.json');
  rsort($files);
  $keep = array_slice($files, 0, $KEEP_DATA);
  $days = [];
  foreach ($files as $f) {
    $day = substr(basename($f), strlen('systema-data-'), 8);
    if (!isset($days[$day]) && count($days) < $KEEP_DAYS) {
      $days[$day] = true;
      $keep[] = $f;
    }
  }
  foreach (array_diff($files, $keep) as $old) {
    @unlink($old);
  }
  reply(200, ['ok' => true, 'stored' => basename($file)]);
}

if ($kind === 'photo') {
  $id = $_GET['id'] ?? '';
  $ext = $_GET['ext'] ?? 'jpg';
  if (!preg_match('/^[a-zA-Z0-9-]{8,64}$/', $id)) {
    reply(400, ['ok' => false, 'error' => 'bad id']);
  }
  if (!in_array($ext, ['jpg', 'png', 'webp'], true)) {
    $ext = 'jpg';
  }
  $file = $BASE . '/photos/' . $id . '.' . $ext;
  if (file_exists($file)) {
    reply(200, ['ok' => true, 'stored' => basename($file), 'existed' => true]);
  }
  if (!write_atomic($file, $body)) {
    reply(500, ['ok' => false, 'error' => 'write failed']);
  }
  reply(200, ['ok' => true, 'stored' => basename($file), 'bytes' => strlen($body)]);
}

reply(400, ['ok' => false, 'error' => 'unknown kind']);
