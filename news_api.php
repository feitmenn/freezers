<?php
// ============================================================
//  Freezers Esports — news_api.php
//  Nahraj tento soubor do STEJNÉ složky jako freezers-esports.html
//  na hosting vega29.fakaheda.eu (nebo kam nahráváš svůj web).
// ============================================================

// ---- 1) ÚDAJE K DATABÁZI (z tvého screenshotu) ----
$DB_HOST = '185.180.2.39';
$DB_NAME = '436119_mysql_db';
$DB_USER = '436119_mysql_db';
$DB_PASS = 'SEM_VLOŽ_HESLO_Z_PHPMYADMIN'; // <-- DOPLNIT: heslo k databázi (nastavíš/najdeš v administraci hostingu)

// ---- 2) HESLO PRO ADMIN PANEL NA WEBU ----
$ADMIN_PASSWORD = 'BjjshYU4564';

// ============================================================
// Od téhle části dál nic měnit nemusíš.
// ============================================================

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

try {
    $pdo = new PDO(
        "mysql:host=$DB_HOST;dbname=$DB_NAME;charset=utf8mb4",
        $DB_USER,
        $DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Nelze se připojit k databázi. Zkontroluj heslo v news_api.php.']);
    exit;
}

// Vytvoří tabulku při prvním spuštění, pokud ještě neexistuje
$pdo->exec("CREATE TABLE IF NOT EXISTS freezers_news (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    image LONGTEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4");

$method = $_SERVER['REQUEST_METHOD'];

// ---- Veřejné čtení novinek (bez hesla) ----
if ($method === 'GET') {
    $stmt = $pdo->query("SELECT id, title, description, image, created_at FROM freezers_news ORDER BY created_at DESC");
    echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
    exit;
}

// ---- Přidání / smazání / přihlášení — vyžaduje heslo ----
if ($method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $action = $input['action'] ?? '';
    $password = $input['password'] ?? '';

    if (!hash_equals($ADMIN_PASSWORD, (string) $password)) {
        http_response_code(403);
        echo json_encode(['error' => 'Špatné heslo']);
        exit;
    }

    if ($action === 'login') {
        echo json_encode(['success' => true]);
        exit;
    }

    if ($action === 'add') {
        $title = trim($input['title'] ?? '');
        $description = trim($input['description'] ?? '');
        $image = $input['image'] ?? null;

        if ($title === '' || $description === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Chybí titulek nebo popisek']);
            exit;
        }

        $stmt = $pdo->prepare("INSERT INTO freezers_news (title, description, image) VALUES (?, ?, ?)");
        $stmt->execute([$title, $description, $image]);
        echo json_encode(['success' => true, 'id' => $pdo->lastInsertId()]);
        exit;
    }

    if ($action === 'delete') {
        $id = intval($input['id'] ?? 0);
        $stmt = $pdo->prepare("DELETE FROM freezers_news WHERE id = ?");
        $stmt->execute([$id]);
        echo json_encode(['success' => true]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Neznámá akce']);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Metoda není povolena']);
