<?php
/**
 * systema backup receiver — runs on the Synology (Web Station + PHP).
 *
 * Accepts two kinds of POST from the systema PWA and writes ONLY inside its
 * own backup folder next to this file:
 *   ?kind=data   body = full JSON snapshot  -> systema-backups/data/…json
 *   ?kind=photo  body = one image blob      -> systema-backups/photos/<id>.<ext>
 *
 * Photos are idempotent (same id never written twice, unless the app asks to
 * replace a copy whose size or SHA-256 doesn't match the original). Every
 * photo reply carries the stored file's size and SHA-256, so the app verifies
 * what landed before it counts a photo as backed up. Data snapshots are
 * pruned to the most recent $KEEP_DATA files plus the newest one of each of
 * the last $KEEP_DAYS days, so older states stay recoverable. Every file is
 * written to a temporary name and renamed into place, so a half-written file
 * is never served. Nothing is ever read or deleted outside this folder.
 *
 * Diagnostics (used by the app's Test connection):
 *   GET  (no kind)        version, upload size limit, whether the folder is writable
 *   POST ?kind=probe      echoes the size it received, writes nothing
 *   GET  ?kind=photos     every stored photo's id and size (the remote manifest)
 *   GET  ?kind=photo&meta=1  one stored photo's size and SHA-256
 * A POST larger than PHP's post_max_size: where PHP drops the body it is
 * reported as HTTP 413 with the limit, not as a mysterious empty body. Keep
 * display_errors off (see docs/nas-backup-setup.md).
 *
 * SETUP: set $TOKEN to a long random string, and enter the same value in
 * systema -> Settings -> NAS sync. See docs/nas-backup-setup.md.
 */

$TOKEN = 'CHANGE-ME-to-a-long-random-string';
$KEEP_DATA = 60; // most recent data snapshots to keep
$KEEP_DAYS = 90; // plus the newest snapshot of each of this many days
$BASE = __DIR__ . '/systema-backups';
$VERSION = 2;

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { // CORS preflight
  http_response_code(204);
  exit;
}

/** Write via a temporary file and rename: readers never see a partial file. */
function write_atomic($file, $body) {
  $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
  if (file_put_contents($tmp, $body) === false) {
    return false;
  }
  if (!rename($tmp, $file)) {
    @unlink($tmp);
    return false;
  }
  return true;
}

function reply($code, $payload) {
  http_response_code($code);
  echo json_encode($payload);
  exit;
}

/** php.ini sizes like "8M" in bytes. */
function ini_bytes($key) {
  $v = trim((string) ini_get($key));
  if ($v === '') {
    return 0;
  }
  $n = (float) $v;
  switch (strtoupper(substr($v, -1))) {
    case 'G': $n *= 1024;
    case 'M': $n *= 1024;
    case 'K': $n *= 1024;
  }
  return (int) $n;
}

function token_ok($token) {
  return $token !== '' && hash_equals($token, (string) ($_GET['token'] ?? ''));
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  $kind = $_GET['kind'] ?? '';
  if ($kind === '') {
    @mkdir($BASE, 0770, true);
    reply(200, [
      'ok' => true,
      'service' => 'systema-backup',
      'version' => $VERSION,
      'maxBody' => ini_bytes('post_max_size'),
      // On, a body over post_max_size makes PHP print a warning before this
      // script's headers: the reply loses its CORS header and the app sees
      // the upload fail, although the file may have been stored.
      'displayErrors' => (bool) ini_get('display_errors'),
      'writable' => is_writable($BASE),
    ]);
  }
  if (!token_ok($TOKEN)) {
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

  // Every stored photo: the remote manifest a check compares against.
  if ($kind === 'photos') {
    $out = [];
    foreach (glob($BASE . '/photos/*.*') ?: [] as $f) {
      $name = basename($f);
      if (!preg_match('/^([a-zA-Z0-9-]{8,64})\.(jpg|png|webp)$/', $name, $m)) {
        continue;
      }
      $out[] = ['id' => $m[1], 'ext' => $m[2], 'bytes' => filesize($f)];
    }
    reply(200, ['ok' => true, 'photos' => $out]);
  }

  // One photo by id, so restores can re-fetch images pushed earlier.
  if ($kind === 'photo') {
    $id = $_GET['id'] ?? '';
    if (!preg_match('/^[a-zA-Z0-9-]{8,64}$/', $id)) {
      reply(400, ['ok' => false, 'error' => 'bad id']);
    }
    $matches = glob($BASE . '/photos/' . $id . '.*');
    $matches = array_values(array_filter($matches ?: [], function ($f) {
      return substr($f, -4) !== '.tmp';
    }));
    if (!$matches) {
      reply(404, ['ok' => false, 'error' => 'not found']);
    }
    $file = $matches[0];
    // ?meta=1: just its size and SHA-256 — lets the app confirm a copy whose
    // upload reply was lost, without sending the photo again.
    if (($_GET['meta'] ?? '') === '1') {
      reply(200, ['ok' => true, 'bytes' => filesize($file), 'sha256' => hash_file('sha256', $file)]);
    }
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
if (!token_ok($TOKEN)) {
  reply(403, ['ok' => false, 'error' => 'bad token']);
}

$kind = $_GET['kind'] ?? '';
$body = file_get_contents('php://input');
if ($body === false || strlen($body) === 0) {
  // PHP drops a body larger than post_max_size before this script runs.
  if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
    reply(413, [
      'ok' => false,
      'error' => 'larger than the PHP limit post_max_size (' . ini_get('post_max_size') . ')',
      'maxBody' => ini_bytes('post_max_size'),
    ]);
  }
  reply(400, ['ok' => false, 'error' => 'empty body']);
}

if ($kind === 'probe') {
  reply(200, ['ok' => true, 'bytes' => strlen($body)]);
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
  reply(200, ['ok' => true, 'stored' => basename($file), 'bytes' => strlen($body)]);
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
  // A stored copy is kept unless the app found it damaged and asks to replace it.
  if (file_exists($file) && ($_GET['replace'] ?? '') !== '1') {
    reply(200, [
      'ok' => true,
      'stored' => basename($file),
      'existed' => true,
      'bytes' => filesize($file),
      'sha256' => hash_file('sha256', $file),
    ]);
  }
  if (!write_atomic($file, $body)) {
    reply(500, ['ok' => false, 'error' => 'write failed']);
  }
  reply(200, [
    'ok' => true,
    'stored' => basename($file),
    'bytes' => strlen($body),
    'sha256' => hash('sha256', $body),
  ]);
}

reply(400, ['ok' => false, 'error' => 'unknown kind']);
