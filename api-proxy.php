<?php
// Reverse proxy: forwards /api/* requests from this domain to the real
// backend, so the browser only ever talks to this same origin. This exists
// because Apache's mod_proxy is blocked by this hosting plan's security
// policy (confirmed: it returns a branded 503 for any proxy attempt), and
// because some browsers (notably Safari) refuse to persist a cookie set by
// a genuinely cross-site fetch() even with SameSite=None; Secure — routing
// through this script makes every request and its Set-Cookie response
// same-origin instead, which every browser accepts without restriction.
//
// Requires enable_post_data_reading=0 (see .user.ini in this same folder)
// so php://input gives the exact raw request body for every content type,
// including multipart/form-data file uploads — without that setting, PHP
// auto-parses multipart bodies into $_POST/$_FILES and php://input is empty,
// which would silently break every file upload proxied through here.

$backend = 'https://vaultex-backend.onrender.com';

$path = isset($_GET['path']) ? $_GET['path'] : '';

$queryString = '';
if (($qpos = strpos($_SERVER['REQUEST_URI'], '?')) !== false) {
    parse_str(substr($_SERVER['REQUEST_URI'], $qpos + 1), $qsParams);
    unset($qsParams['path']);
    if (count($qsParams) > 0) {
        $queryString = '?' . http_build_query($qsParams);
    }
}

$url = $backend . '/' . ltrim($path, '/') . $queryString;

$method = $_SERVER['REQUEST_METHOD'];
$rawBody = file_get_contents('php://input');

$forwardHeaders = [];
foreach (getallheaders() as $name => $value) {
    $lower = strtolower($name);
    if (in_array($lower, ['host', 'content-length', 'connection', 'accept-encoding'], true)) continue;
    $forwardHeaders[] = "$name: $value";
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $forwardHeaders,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_TIMEOUT => 60,
    CURLOPT_ENCODING => '', // let curl transparently decompress gzip/br from the backend
]);
if (!in_array($method, ['GET', 'HEAD'], true)) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $rawBody);
}

$response = curl_exec($ch);
if ($response === false) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['message' => 'Could not reach the backend: ' . curl_error($ch)]);
    curl_close($ch);
    exit;
}

$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$responseHeaders = substr($response, 0, $headerSize);
$responseBody = substr($response, $headerSize);
curl_close($ch);

http_response_code($statusCode);

// Forward every response header, INCLUDING every Set-Cookie line (there can
// be more than one) — this is what actually gets the session cookie stored
// as a same-origin cookie for this domain instead of the backend's.
foreach (preg_split('/\r\n/', $responseHeaders) as $headerLine) {
    if (trim($headerLine) === '') continue;
    if (stripos($headerLine, 'HTTP/') === 0) continue;
    if (stripos($headerLine, 'Transfer-Encoding:') === 0) continue;
    if (stripos($headerLine, 'Content-Encoding:') === 0) continue;
    if (stripos($headerLine, 'Content-Length:') === 0) continue;
    if (stripos($headerLine, 'Connection:') === 0) continue;
    header($headerLine, false);
}

echo $responseBody;
