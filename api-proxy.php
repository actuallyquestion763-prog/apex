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
// REQUEST BODIES. The default is to forward php://input EXACTLY, byte for
// byte, with the original Content-Type (multipart boundary included). That is
// correct for every method except one case:
//
//   PHP only ever auto-parses multipart/form-data into $_POST/$_FILES for
//   POST, and only while enable_post_data_reading is on — which this
//   Namecheap/CloudLinux account locks ON (.user.ini cannot change it). For
//   that one case (multipart POST) php://input is EMPTY, so forwarding it
//   would send the backend a boundary with no body ("Multipart: Unexpected
//   end of form"). Only then is an equivalent body rebuilt from what PHP
//   parsed — see mp_build_multipart_body().
//
// PATCH, PUT and DELETE are never parsed by PHP, so their $_POST/$_FILES are
// always empty; rebuilding from them would forward a body with ZERO fields
// (the backend then reports every field as missing). They must never take the
// rebuild path — php://input already holds the complete, exact body.

$backend = 'https://vaultex-backend.onrender.com';

// ============================================================================
// Multipart reconstruction — pure functions (no superglobals, no network), used
// only for the multipart-POST case described above.
// ============================================================================

function mp_generate_boundary(): string {
    return '----EdgeTradeProxyBoundary' . bin2hex(random_bytes(16));
}

// Escapes a value going into a Content-Disposition header per RFC 7578 —
// defends against header injection via a crafted field/file name (a
// filename is client-supplied, so this must never be trusted verbatim).
function mp_escape_header_value(string $value): string {
    return str_replace(['\\', '"', "\r", "\n"], ['\\\\', '\\"', '', ''], $value);
}

// PHP's $_POST can hold scalars or arrays (from a "name[]" or "name[key]"
// field). Flattens either shape into a list of [wireName, stringValue]
// pairs using PHP's own bracket notation, matching what the browser
// actually put on the wire for an array-shaped field. (PHP rewrites "." and
// " " in TOP-LEVEL field names to "_" while parsing; no field this app sends
// contains either.)
function mp_flatten_post_fields(array $post): array {
    $out = [];
    $walk = function ($value, string $name) use (&$walk, &$out) {
        if (is_array($value)) {
            foreach ($value as $key => $inner) {
                $childName = is_int($key) ? "{$name}[]" : "{$name}[{$key}]";
                $walk($inner, $childName);
            }
            return;
        }
        $out[] = [$name, (string) $value];
    };
    foreach ($post as $name => $value) {
        $walk($value, (string) $name);
    }
    return $out;
}

// $_FILES stores a multi-file field ("files[]") as parallel nested arrays.
// Flattens it into a list of [wireName, ['name','type','tmp_name','error']].
function mp_flatten_files(array $files): array {
    $out = [];
    $walk = function (array $names, array $types, array $tmps, array $errors, string $prefix) use (&$walk, &$out) {
        foreach ($names as $key => $name) {
            $child = is_int($key) ? "{$prefix}[]" : "{$prefix}[{$key}]";
            if (is_array($name)) {
                $walk($name, $types[$key], $tmps[$key], $errors[$key], $child);
                continue;
            }
            $out[] = [$child, ['name' => $name, 'type' => $types[$key], 'tmp_name' => $tmps[$key], 'error' => $errors[$key]]];
        }
    };
    foreach ($files as $field => $spec) {
        if (is_array($spec['name'])) {
            $walk($spec['name'], $spec['type'], $spec['tmp_name'], $spec['error'], (string) $field);
        } else {
            $out[] = [(string) $field, $spec];
        }
    }
    return $out;
}

// Rebuilds a multipart/form-data body from PHP's parsed $_POST / $_FILES.
// Throws RuntimeException(message, httpStatus) if PHP had to discard an upload
// (size limit / partial) — silently dropping the file would surface as a
// confusing "file missing" error from the backend instead of the real cause.
function mp_build_multipart_body(array $post, array $files, string $boundary): string {
    $body = '';
    foreach (mp_flatten_post_fields($post) as [$name, $value]) {
        $body .= "--{$boundary}\r\nContent-Disposition: form-data; name=\"" . mp_escape_header_value($name) . "\"\r\n\r\n{$value}\r\n";
    }
    foreach (mp_flatten_files($files) as [$name, $file]) {
        $error = (int) $file['error'];
        if ($error === UPLOAD_ERR_NO_FILE) continue; // an empty file input — nothing was sent
        if ($error === UPLOAD_ERR_INI_SIZE || $error === UPLOAD_ERR_FORM_SIZE) {
            throw new RuntimeException('The uploaded file is larger than this server allows.', 413);
        }
        if ($error !== UPLOAD_ERR_OK) {
            throw new RuntimeException('The file upload did not complete. Please try again.', 400);
        }
        $type = preg_replace('/[\r\n]/', '', (string) $file['type']);
        if ($type === '') $type = 'application/octet-stream';
        $body .= "--{$boundary}\r\nContent-Disposition: form-data; name=\"" . mp_escape_header_value($name)
            . "\"; filename=\"" . mp_escape_header_value((string) $file['name']) . "\"\r\nContent-Type: {$type}\r\n\r\n"
            . file_get_contents($file['tmp_name']) . "\r\n";
    }
    return $body . "--{$boundary}--\r\n";
}

// Read the path from the RAW request URI, not from $_GET['path']. The
// .htaccess RewriteRule captures the path into ?path=$1, but Apache's
// rewrite engine decodes percent-encoded slashes (%2F -> /) before that
// capture happens — so a request for /api/markets/XAU%2FUSD/quote (where
// %2F must stay encoded, since the backend's route is :symbol/quote with
// the whole "XAU/USD" as ONE path segment) arrived at this script as
// markets/XAU/USD/quote, four segments instead of three, and the backend's
// router 404'd. $_SERVER['REQUEST_URI'] reflects the client's original
// request line, untouched by that internal rewrite decoding, so slicing
// the path out of it here preserves %2F exactly as the client sent it.
$requestUri = $_SERVER['REQUEST_URI'];
$qpos = strpos($requestUri, '?');
$rawPath = $qpos !== false ? substr($requestUri, 0, $qpos) : $requestUri;
$queryString = $qpos !== false ? substr($requestUri, $qpos) : '';
$path = preg_replace('#^/api/#', '', $rawPath, 1);

$url = $backend . '/' . ltrim($path, '/') . $queryString;

$method = $_SERVER['REQUEST_METHOD'];
$rawBody = file_get_contents('php://input');

$forwardHeaders = [];
$contentType = '';
foreach (getallheaders() as $name => $value) {
    $lower = strtolower($name);
    if (in_array($lower, ['host', 'content-length', 'connection', 'accept-encoding'], true)) continue;
    $forwardHeaders[] = "$name: $value";
    if ($lower === 'content-type') $contentType = $value;
}

// The ONE case that needs a rebuilt body: multipart POST whose php://input PHP
// already consumed (see the header comment). Everything else — multipart
// PATCH/PUT/DELETE, multipart POST where php://input is intact, JSON, and
// bodiless requests — keeps $rawBody and its original Content-Type untouched.
if (
    $method === 'POST'
    && $rawBody === ''
    && stripos(ltrim($contentType), 'multipart/form-data') === 0
    && (!empty($_POST) || !empty($_FILES))
) {
    try {
        $boundary = mp_generate_boundary();
        $rawBody = mp_build_multipart_body($_POST, $_FILES, $boundary);
    } catch (RuntimeException $e) {
        http_response_code($e->getCode() === 413 ? 413 : 400);
        header('Content-Type: application/json');
        echo json_encode(['message' => $e->getMessage()]);
        exit;
    }
    // The original Content-Type names the BROWSER's boundary, which no longer
    // appears in the rebuilt body — replace it with the new one.
    $forwardHeaders = array_values(array_filter($forwardHeaders, fn($h) => stripos($h, 'content-type:') !== 0));
    $forwardHeaders[] = "Content-Type: multipart/form-data; boundary={$boundary}";
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
