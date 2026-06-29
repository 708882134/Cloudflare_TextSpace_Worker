// ============= 文本云盘 Worker（基于Cloudflare）=============
// 环境变量：ADMIN_UUID（必填）
// D1 绑定：DB（必填）
// KV 绑定：SHARE_KV（强烈推荐，用于加速访客访问）
//Youtube频道：好软推荐
//仅供学习使用，勿用于非法
//基于GPLv3协议的开源特性

const DEFAULT_FRONTEND_URL = "https://text-disk-ui.pages.dev";
const ADMIN_COOKIE_MAX_AGE = 36000; //默认1个小时，可按需修改
const KV_TTL = 60 * 60 * 24 * 7;
const CACHE_TTL = 60 * 60 * 24 * 365;
let ADMIN_UUID = null;
let dbInitialized = false;
function uuidv4() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (
      c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
    ).toString(16),
  );
}
function isFolder(name) {
  return name.endsWith("/");
}
function getParentPath(path) {
  const p = path.split("/").filter(Boolean);
  p.pop();
  return p.length ? p.join("/") + "/" : "";
}
function getBaseName(path) {
  const p = path.split("/");
  return isFolder(path) ? p[p.length - 2] + "/" : p[p.length - 1];
}
function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
function isAdminAuthenticated(request, adminUuid) {
  if (getCookie(request, "admin_token") === adminUuid) return true;
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${adminUuid}`;
}
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-File-Name, X-File-Token, X-Content-Type, X-Content-Encoding",
};
function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}
function json(data, status = 200) {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}
function text(data, status = 200, headers = {}) {
  return withCors(
    new Response(data, {
      status,
      headers: { "Content-Type": "text/plain;charset=utf-8", ...headers },
    }),
  );
}
function htmlResponse(html, status = 200) {
  return withCors(
    new Response(html, {
      status,
      headers: { "Content-Type": "text/html;charset=utf-8" },
    }),
  );
}
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function displayName(path, isFolder) {
  const trimmed = isFolder && path.endsWith("/") ? path.slice(0, -1) : path;
  const parts = trimmed.split("/").filter(Boolean);
  const name = parts[parts.length - 1] || trimmed;
  return isFolder ? name + "/" : name;
}
function kindLabel(kind) {
  if (kind === "image") return "图片";
  if (kind === "json") return "JSON";
  if (kind === "folder") return "文件夹";
  return "文本";
}
function folderListingPage(listing, folderUrl) {
  const folderLabel = listing.folder.replace(/\/$/, "") || "根目录";
  const sorted = [...listing.items].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return displayName(a.name, a.isFolder).localeCompare(
      displayName(b.name, b.isFolder),
      "zh-CN",
    );
  });
  const rows = sorted.length
    ? sorted
        .map((item) => {
          const name = displayName(item.name, item.isFolder);
          const icon = item.isFolder ? "📁" : item.kind === "image" ? "🖼️" : item.kind === "json" ? "📋" : "📄";
          return `<li class="item">
            <a class="item-link" href="${escapeHtml(item.url)}">
              <span class="icon">${icon}</span>
              <span class="name">${escapeHtml(name)}</span>
              <span class="kind">${escapeHtml(kindLabel(item.isFolder ? "folder" : item.kind))}</span>
            </a>
          </li>`;
        })
        .join("")
    : `<li class="empty">此文件夹为空</li>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(folderLabel)} - CF-txt</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f5f7;
      color: #1d1d1f;
    }
    .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 48px; }
    .card {
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 8px 28px rgba(0,0,0,.08);
      overflow: hidden;
    }
    .header {
      padding: 24px 24px 16px;
      border-bottom: 1px solid #ececec;
    }
    .title { margin: 0; font-size: 24px; font-weight: 700; }
    .subtitle { margin: 8px 0 0; color: #6e6e73; font-size: 14px; }
    ul { list-style: none; margin: 0; padding: 8px 0; }
    .item { border-bottom: 1px solid #f0f0f0; }
    .item:last-child { border-bottom: none; }
    .item-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 24px;
      color: inherit;
      text-decoration: none;
      transition: background .15s ease;
    }
    .item-link:hover { background: #f5f5f7; }
    .icon { font-size: 18px; width: 24px; text-align: center; }
    .name { flex: 1; font-size: 15px; font-weight: 500; word-break: break-all; }
    .kind { font-size: 12px; color: #86868b; background: #f2f2f7; padding: 4px 8px; border-radius: 999px; }
    .empty { padding: 28px 24px; color: #86868b; text-align: center; }
    .footer { margin-top: 16px; text-align: center; color: #86868b; font-size: 12px; }
    .footer a { color: #0071e3; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="header">
        <h1 class="title">📂 ${escapeHtml(folderLabel)}</h1>
        <p class="subtitle">共 ${sorted.length} 项 · 点击文件查看内容，点击文件夹进入子目录</p>
      </div>
      <ul>${rows}</ul>
    </div>
    <p class="footer">CF-txt 分享目录 · <a href="${escapeHtml(folderUrl)}?format=json">API JSON</a></p>
  </div>
</body>
</html>`;
}
function sanitizePath(path) {
  if (!path) return "";
  if (path.includes("..")) throw new Error("非法文件名");
  return path;
}
function mimeFromPath(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
  return "text/plain";
}
function isBinaryMime(mime) {
  return mime.startsWith("image/");
}
function fileKindFromMime(mime) {
  if (mime === "application/json") return "json";
  if (mime.startsWith("image/")) return "image";
  return "text";
}
function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function isImagePath(path) {
  return /\.(png|jpe?g|gif|webp)$/i.test(path || "");
}
function looksLikeBase64(value) {
  if (!value || typeof value !== "string" || value.length < 16) return false;
  return /^[A-Za-z0-9+/=\r\n]+$/.test(value.slice(0, Math.min(256, value.length)));
}
function normalizeFileRecord(path, record) {
  if (!record) return null;
  let { content, mimeType, encoding } = record;
  const pathMime = mimeFromPath(path);
  if (!mimeType || mimeType === "text/plain") {
    if (isImagePath(path)) mimeType = pathMime;
    else if (path.endsWith(".json")) mimeType = "application/json";
  }
  if (isBinaryMime(mimeType)) {
    if (encoding !== "base64" && looksLikeBase64(content)) encoding = "base64";
    if (encoding !== "base64" && content && typeof content === "string") {
      encoding = "base64";
      content = bytesToBase64(new TextEncoder().encode(content));
    }
    if (encoding !== "base64") encoding = "base64";
  }
  return { content: content || "", mimeType, encoding: encoding || "text" };
}
function base64ToBytes(base64) {
  const clean = (base64 || "").replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function responseFromStored(content, mimeType, encoding, path = "") {
  const normalized = normalizeFileRecord(path, { content, mimeType, encoding });
  content = normalized.content;
  mimeType = normalized.mimeType;
  encoding = normalized.encoding;
  if (encoding === "base64" || isBinaryMime(mimeType)) {
    const bytes = base64ToBytes(content || "");
    const type = isBinaryMime(mimeType) ? mimeType : mimeFromPath(path);
    return withCors(
      new Response(bytes, {
        headers: {
          "Content-Type": type || "application/octet-stream",
          "Cache-Control": "public, max-age=60",
        },
      }),
    );
  }
  if (mimeType === "application/json") {
    return withCors(
      new Response(content || "", {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        },
      }),
    );
  }
  return text(content || "");
}
function hashForSync(content, encoding, mimeType) {
  let bytes;
  if (encoding === "base64" || isBinaryMime(mimeType)) {
    bytes = base64ToBytes(content || "");
  } else {
    bytes = new TextEncoder().encode(content || "");
  }
  return md5Hex(bytes);
}
function md5Hex(bytes) {
  const m = md5Bytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return Array.from(m)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function md5Bytes(data) {
  function rotl(x, n) {
    return (x << n) | (x >>> (32 - n));
  }
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++)
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  const msg = data instanceof Uint8Array ? data : new Uint8Array(data);
  const origLen = msg.length;
  const withOne = new Uint8Array(((origLen + 8) >> 6) + 1 << 6);
  withOne.set(msg);
  withOne[origLen] = 0x80;
  const bitLen = origLen * 8;
  const view = new DataView(withOne.buffer);
  view.setUint32(withOne.length - 8, bitLen >>> 0, true);
  view.setUint32(withOne.length - 4, Math.floor(bitLen / 2 ** 32), true);
  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  for (let i = 0; i < withOne.length; i += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++)
      M[j] = view.getUint32(i + j * 4, true);
    let A = a0,
      B = b0,
      C = c0,
      D = d0;
    for (let j = 0; j < 64; j++) {
      let F, g;
      if (j < 16) {
        F = (B & C) | (~B & D);
        g = j;
      } else if (j < 32) {
        F = (D & B) | (~D & C);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        F = B ^ C ^ D;
        g = (3 * j + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * j) % 16;
      }
      const tmp = D;
      D = C;
      C = B;
      const sum = (A + F + K[j] + M[g]) >>> 0;
      B = (B + rotl(sum, [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21][j])) >>> 0;
      A = tmp;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const o = new DataView(out.buffer);
  o.setUint32(0, a0, true);
  o.setUint32(4, b0, true);
  o.setUint32(8, c0, true);
  o.setUint32(12, d0, true);
  return out;
}
async function initDB(env) {
  if (dbInitialized) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,is_folder INTEGER NOT NULL,content TEXT,token TEXT,mime_type TEXT DEFAULT 'text/plain',encoding TEXT DEFAULT 'text',content_md5 TEXT,created_at INTEGER DEFAULT(unixepoch()),updated_at INTEGER DEFAULT(unixepoch()));CREATE INDEX IF NOT EXISTS idx_path_prefix ON files(path);`,
  ).run();
  try {
    await env.DB.prepare(
      "ALTER TABLE files ADD COLUMN mime_type TEXT DEFAULT 'text/plain'",
    ).run();
  } catch {}
  try {
    await env.DB.prepare(
      "ALTER TABLE files ADD COLUMN encoding TEXT DEFAULT 'text'",
    ).run();
  } catch {}
  try {
    await env.DB.prepare(
      "ALTER TABLE files ADD COLUMN content_md5 TEXT",
    ).run();
  } catch {}
  dbInitialized = true;
}
function getCacheKey(request, token, path) {
  const u = new URL(request.url);
  return new Request(
    `${u.origin}/__cache__/${token}_${encodeURIComponent(path)}`,
  );
}
async function getCFCache(request, token, path) {
  return caches.default.match(getCacheKey(request, token, path));
}
async function putCFCache(request, token, path, payload) {
  const mimeType = payload?.mimeType || "text/plain";
  const encoding = payload?.encoding || "text";
  const content = payload?.content ?? payload ?? "";
  const body =
    encoding === "base64" || isBinaryMime(mimeType)
      ? base64ToBytes(content)
      : content;
  return caches.default.put(
    getCacheKey(request, token, path),
    new Response(body, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": `public,max-age=${CACHE_TTL}`,
      },
    }),
  );
}
async function purgeCFCache(request, token, path) {
  if (!token) return;
  return caches.default.delete(getCacheKey(request, token, path));
}
async function getKVKey(token, path) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(path),
  );
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  return `share_${token}_${hex}`;
}
async function setShareCache(env, token, path, payload, oldToken) {
  if (!env.SHARE_KV || !token) return;
  const opts = KV_TTL > 0 ? { expirationTtl: KV_TTL } : {};
  const record =
    typeof payload === "string"
      ? { token, content: payload, mimeType: "text/plain", encoding: "text" }
      : { token, ...payload };
  await env.SHARE_KV.put(await getKVKey(token, path), JSON.stringify(record), opts);
  if (oldToken && oldToken !== token)
    await env.SHARE_KV.delete(await getKVKey(oldToken, path));
}
async function updateShareCache(env, token, path, payload) {
  if (!env.SHARE_KV || !token) return;
  const record =
    typeof payload === "string"
      ? { token, content: payload, mimeType: "text/plain", encoding: "text" }
      : { token, ...payload };
  await env.SHARE_KV.put(
    await getKVKey(token, path),
    JSON.stringify(record),
    KV_TTL > 0 ? { expirationTtl: KV_TTL } : {},
  );
}
async function deleteShareCache(env, token, path) {
  if (env.SHARE_KV && token)
    await env.SHARE_KV.delete(await getKVKey(token, path));
}
async function getShareCache(env, token, path) {
  if (!env.SHARE_KV) return null;
  const raw = await env.SHARE_KV.get(await getKVKey(token, path));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o.token !== token) return null;
    return {
      content: o.content ?? "",
      mimeType: o.mimeType || mimeFromPath(path),
      encoding: o.encoding || (looksLikeBase64(o.content) ? "base64" : "text"),
    };
  } catch {
    return null;
  }
}
async function getFileList(env) {
  const rows = (
    await env.DB.prepare(
      "SELECT path, is_folder, mime_type, encoding, content_md5, updated_at FROM files ORDER BY path",
    ).all()
  ).results;
  const out = [];
  for (const r of rows) {
    let contentMd5 = r.content_md5 || "";
    if (r.is_folder !== 1 && !contentMd5) {
      const rec = await getFileRecord(env, r.path);
      if (rec) {
        contentMd5 = hashForSync(rec.content, rec.encoding, rec.mimeType);
        await env.DB.prepare("UPDATE files SET content_md5 = ? WHERE path = ?")
          .bind(contentMd5, r.path)
          .run();
      }
    }
    out.push({
      name: r.path,
      isFolder: r.is_folder === 1,
      mimeType: r.mime_type || "text/plain",
      kind:
        r.is_folder === 1
          ? "folder"
          : fileKindFromMime(r.mime_type || "text/plain"),
      encoding: r.encoding || "text",
      contentMd5,
      updatedAt: r.updated_at || 0,
    });
  }
  return out;
}
async function getFileRecord(env, filename) {
  if (isFolder(filename)) return null;
  const row = (
    await env.DB.prepare(
      "SELECT content, mime_type, encoding FROM files WHERE path = ?",
    )
      .bind(filename)
      .all()
  ).results[0];
  if (!row) return null;
  return normalizeFileRecord(filename, {
    content: row.content || "",
    mimeType: row.mime_type || mimeFromPath(filename),
    encoding: row.encoding || "text",
  });
}
async function getFileContent(env, filename) {
  return (await getFileRecord(env, filename))?.content || "";
}
async function saveFileContent(env, filename, rawContent, token = null, opts = {}) {
  if (isFolder(filename)) return null;
  const mimeType = opts.mimeType || mimeFromPath(filename);
  const encoding =
    opts.encoding || (isBinaryMime(mimeType) ? "base64" : "text");
  let content = rawContent;
  if (encoding === "base64" && typeof rawContent !== "string") {
    content = bytesToBase64(new Uint8Array(rawContent));
  }
  if (token === null) {
    const r = await env.DB.prepare("SELECT token FROM files WHERE path = ?")
      .bind(filename)
      .all();
    token = r.results[0]?.token || null;
  }
  const payload = { content, mimeType, encoding };
  const contentMd5 = hashForSync(content, encoding, mimeType);
  const res = await env.DB.prepare(
    "UPDATE files SET content = ?, mime_type = ?, encoding = ?, content_md5 = ?, updated_at = unixepoch() WHERE path = ? AND is_folder = 0",
  )
    .bind(content, mimeType, encoding, contentMd5, filename)
    .run();
  if (res.changes === 0) throw new Error("文件不存在，请先创建文件");
  if (token) await updateShareCache(env, token, filename, payload);
  return token;
}
async function deleteFile(env, filename) {
  const isDir = isFolder(filename);
  let items = [];
  if (isDir) {
    const r = await env.DB.prepare(
      "SELECT token, path FROM files WHERE path = ? OR path LIKE ? || '%'",
    )
      .bind(filename, filename)
      .all();
    items = r.results
      .map((x) => ({ token: x.token, path: x.path }))
      .filter((t) => t.token);
    await env.DB.prepare(
      "DELETE FROM files WHERE path = ? OR path LIKE ? || '%'",
    )
      .bind(filename, filename)
      .run();
  } else {
    const r = await env.DB.prepare(
      "SELECT token, path FROM files WHERE path = ?",
    )
      .bind(filename)
      .all();
    if (r.results.length && r.results[0].token)
      items.push({ token: r.results[0].token, path: r.results[0].path });
    await env.DB.prepare("DELETE FROM files WHERE path = ?")
      .bind(filename)
      .run();
  }
  for (const t of items) await deleteShareCache(env, t.token, t.path);
  return items;
}
async function renameFile(env, oldName, newName) {
  if (oldName === newName) return [];
  if (
    (
      await env.DB.prepare("SELECT path FROM files WHERE path = ?")
        .bind(newName)
        .all()
    ).results.length
  )
    throw new Error("目标名称已存在");
  const isDir = isFolder(oldName);
  let tokens = [];
  if (isDir) {
    const od = oldName.endsWith("/") ? oldName : oldName + "/";
    const nd = newName.endsWith("/") ? newName : newName + "/";
    const r = await env.DB.prepare(
      "SELECT token, path FROM files WHERE path LIKE ? || '%'",
    )
      .bind(od)
      .all();
    tokens = r.results
      .map((x) => ({ token: x.token, path: x.path }))
      .filter((t) => t.token);
    await env.DB.prepare(
      "UPDATE files SET path = REPLACE(path, ?, ?), updated_at = unixepoch() WHERE path LIKE ? || '%'",
    )
      .bind(od, nd, od)
      .run();
  } else {
    const r = await env.DB.prepare(
      "SELECT token, path FROM files WHERE path = ?",
    )
      .bind(oldName)
      .all();
    tokens = r.results
      .map((x) => ({ token: x.token, path: x.path }))
      .filter((t) => t.token);
    await env.DB.prepare(
      "UPDATE files SET path = ?, mime_type = ?, encoding = ?, updated_at = unixepoch() WHERE path = ?",
    )
      .bind(newName, mimeFromPath(newName), isBinaryMime(mimeFromPath(newName)) ? "base64" : "text", oldName)
      .run();
  }
  for (const t of tokens) await deleteShareCache(env, t.token, t.path);
  return tokens;
}
async function moveItem(env, itemName, targetFolder) {
  let target = targetFolder.endsWith("/") ? targetFolder : targetFolder + "/";
  if (isFolder(itemName) && target.startsWith(itemName))
    throw new Error("不能将文件夹移动到自身或其子文件夹中");
  const base = getBaseName(itemName),
    newPath = target + base;
  if (
    (
      await env.DB.prepare("SELECT path FROM files WHERE path = ?")
        .bind(newPath)
        .all()
    ).results.length
  )
    throw new Error("目标位置已存在同名文件");
  return renameFile(env, itemName, newPath);
}
async function isDbFolder(env, path) {
  const p = path.endsWith("/") ? path : path + "/";
  const row = (
    await env.DB.prepare("SELECT is_folder FROM files WHERE path = ?")
      .bind(p)
      .all()
  ).results[0];
  return row?.is_folder === 1;
}
async function normalizeFolderPath(env, path) {
  if (!path) return null;
  if (await isDbFolder(env, path)) return path.endsWith("/") ? path : path + "/";
  return null;
}
async function resolveShareAccess(env, token, path) {
  if ((await getFileToken(env, path)) === token) return true;
  let parent = isFolder(path) ? getParentPath(path.slice(0, -1)) : getParentPath(path);
  while (parent) {
    if ((await getFileToken(env, parent)) === token) return true;
    const trimmed = parent.endsWith("/") ? parent.slice(0, -1) : parent;
    const parts = trimmed.split("/").filter(Boolean);
    parts.pop();
    parent = parts.length ? parts.join("/") + "/" : "";
  }
  return false;
}
async function listDirectChildren(env, folderPath, token, request) {
  const prefix = folderPath.endsWith("/") ? folderPath : folderPath + "/";
  const all = await getFileList(env);
  const origin = new URL(request.url).origin;
  const children = all.filter((f) => {
    if (!f.name.startsWith(prefix) || f.name === prefix) return false;
    const rest = f.name.slice(prefix.length);
    if (f.isFolder) return !rest.slice(0, -1).includes("/");
    return !rest.includes("/");
  });
  return {
    folder: prefix,
    token,
    items: children.map((c) => ({
      name: c.name,
      isFolder: c.isFolder,
      kind: c.kind,
      mimeType: c.mimeType,
      url:
        origin +
        "/sub/" +
        token +
        "/" +
        c.name
          .split("/")
          .map((s) => encodeURIComponent(s))
          .join("/"),
    })),
  };
}
async function folderShareAllowed(env, token, folderPath) {
  const fp = folderPath.endsWith("/") ? folderPath : folderPath + "/";
  if ((await getFileToken(env, fp)) === token) return true;
  let parent = getParentPath(fp.slice(0, -1));
  while (parent) {
    if ((await getFileToken(env, parent)) === token) return true;
    const trimmed = parent.endsWith("/") ? parent.slice(0, -1) : parent;
    const parts = trimmed.split("/").filter(Boolean);
    parts.pop();
    parent = parts.length ? parts.join("/") + "/" : "";
  }
  return false;
}
async function getFileToken(env, filename) {
  return (
    (
      await env.DB.prepare("SELECT token FROM files WHERE path = ?")
        .bind(filename)
        .all()
    ).results[0]?.token || ""
  );
}
async function saveFileToken(env, filename, token) {
  const old =
    (
      await env.DB.prepare("SELECT token FROM files WHERE path = ?")
        .bind(filename)
        .all()
    ).results[0]?.token || null;
  const res = await env.DB.prepare(
    "UPDATE files SET token = ?, updated_at = unixepoch() WHERE path = ?",
  )
    .bind(token, filename)
    .run();
  if (res.changes === 0) {
    const folder = filename.endsWith("/") || (await isDbFolder(env, filename));
    if (folder) {
      const fp = filename.endsWith("/") ? filename : filename + "/";
      await env.DB.prepare(
        "INSERT INTO files (path, is_folder, content, token, created_at, updated_at) VALUES (?, 1, NULL, ?, unixepoch(), unixepoch())",
      )
        .bind(fp, token)
        .run();
    } else {
      await env.DB.prepare(
        "INSERT INTO files (path, is_folder, content, token, created_at, updated_at) VALUES (?, 0, '', ?, unixepoch(), unixepoch())",
      )
        .bind(filename, token)
        .run();
    }
  }
  if (!isFolder(filename) && !(await isDbFolder(env, filename))) {
    await setShareCache(
      env,
      token,
      filename,
      await getFileRecord(env, filename),
      old,
    );
  }
  return { oldToken: old, newToken: token };
}
async function createNewFile(env, fullPath) {
  const mimeType = mimeFromPath(fullPath);
  const encoding = isBinaryMime(mimeType) ? "base64" : "text";
  await env.DB.prepare(
    "INSERT INTO files (path, is_folder, content, token, mime_type, encoding, created_at, updated_at) VALUES (?, 0, '', NULL, ?, ?, unixepoch(), unixepoch())",
  )
    .bind(fullPath, mimeType, encoding)
    .run();
}
async function createNewFolder(env, fullPath) {
  await env.DB.prepare(
    "INSERT INTO files (path, is_folder, content, token, created_at, updated_at) VALUES (?, 1, NULL, NULL, unixepoch(), unixepoch())",
  )
    .bind(fullPath)
    .run();
}
async function proxyFrontend(frontendUrl, request, ctx) {
  const cacheKey = new URL(frontendUrl);
  const cached = await caches.default.match(cacheKey);
  if (cached)
    return new Response(cached.body, {
      headers: {
        ...cached.headers,
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "Content-Type": "text/html;charset=utf-8",
      },
    });
  const res = await fetch(frontendUrl, { cf: { cacheEverything: true } });
  const newRes = new Response(res.body, {
    status: res.status,
    headers: {
      ...res.headers,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Type": "text/html;charset=utf-8",
    },
  });
  ctx.waitUntil(caches.default.put(cacheKey, newRes.clone()));
  return newRes;
}
export default {
  async fetch(request, env, ctx) {
    ADMIN_UUID = env.ADMIN_UUID || ADMIN_UUID;
    const url = new URL(request.url);
    const pathname = url.pathname.slice(1);
    const parts = pathname.split("/");
    if (!ADMIN_UUID) return text("⚠️ 请设置环境变量 ADMIN_UUID", 400);
    if (parts[0] === "sub" && parts.length >= 3) {
      try {
        const token = parts[1];
        const decodedPath = decodeURIComponent(parts.slice(2).join("/"));
        await initDB(env);
        const folderPath = await normalizeFolderPath(env, decodedPath);
        if (folderPath) {
          if (!(await folderShareAllowed(env, token, folderPath)))
            return text("Token无效或文件夹不存在", 403);
          const listing = await listDirectChildren(env, folderPath, token, request);
          const wantJson =
            url.searchParams.get("format") === "json" ||
            (request.headers.get("Accept") || "").includes("application/json");
          if (wantJson) return json(listing);
          const pageUrl = new URL(request.url);
          pageUrl.searchParams.delete("format");
          return htmlResponse(folderListingPage(listing, pageUrl.toString()));
        }
        const allowed = await resolveShareAccess(env, token, decodedPath);
        if (!allowed) return text("Token无效或文件不存在", 403);
        const kv = await getShareCache(env, token, decodedPath);
        if (kv !== null) {
          ctx.waitUntil(putCFCache(request, token, decodedPath, kv));
          return responseFromStored(kv.content, kv.mimeType, kv.encoding, decodedPath);
        }
        const record = await getFileRecord(env, decodedPath);
        if (!record) return text("文件不存在", 404);
        ctx.waitUntil(
          Promise.all([
            updateShareCache(env, token, decodedPath, record),
            putCFCache(request, token, decodedPath, record),
          ]),
        );
        return responseFromStored(record.content, record.mimeType, record.encoding, decodedPath);
      } catch (e) {
        return text("访问失败：" + e.message, 400);
      }
    }
    if (parts[0] === "sub")
      return text("格式错误：/sub/<Token>/<路径>/<文件名>", 400);
    await initDB(env);
    if (pathname === "admin" || pathname.startsWith("admin/")) {
      if (request.method === "OPTIONS")
        return withCors(new Response(null, { status: 204 }));
      if (
        request.method === "GET" &&
        !url.searchParams.has("action") &&
        !url.searchParams.has("file") &&
        !request.headers.get("X-File-Name")
      ) {
        const frontendUrl = env.FRONTEND_URL || DEFAULT_FRONTEND_URL;
        return proxyFrontend(frontendUrl, request, ctx);
      }
      let body = "";
      let rawBody = null;
      if (request.method === "POST") {
        rawBody = await request.arrayBuffer();
        body = new TextDecoder().decode(rawBody);
      }
      if (body.startsWith("LOGIN|")) {
        const inp = body.split("|")[1];
        if (inp === ADMIN_UUID)
          return text("登录成功", 200, {
            "Set-Cookie": `admin_token=${ADMIN_UUID};Path=/;HttpOnly;SameSite=Lax;Secure;Max-Age=${ADMIN_COOKIE_MAX_AGE}`,
          });
        return text("UUID错误", 401);
      }
      if (body.startsWith("LOGOUT"))
        return text("已登出", 200, {
          "Set-Cookie": `admin_token=;Path=/;HttpOnly;SameSite=Lax;Secure;Max-Age=0`,
        });
      if (!isAdminAuthenticated(request, ADMIN_UUID)) return text("未登录", 401);
      if (url.searchParams.get("action") === "get_tree")
        return json(await getFileList(env));
      if (body.startsWith("FILE_TOKEN|")) {
        const [_, filename, custom] = body.split("|");
        if (!filename) return text("缺少文件名", 400);
        const result = await saveFileToken(
          env,
          filename,
          custom?.trim() || uuidv4(),
        );
        if (result.oldToken && result.oldToken !== result.newToken) {
          ctx.waitUntil(purgeCFCache(request, result.oldToken, filename));
        }
        const newToken = await getFileToken(env, filename);
        ctx.waitUntil(purgeCFCache(request, newToken, filename));
        return text(newToken);
      }
      if (body.startsWith("GET_TOKEN|")) {
        const [_, filename] = body.split("|");
        if (!filename) return text("缺少文件名", 400);
        return text((await getFileToken(env, filename)) || "该文件未生成Token");
      }
      if (body.startsWith("FILE_OP|")) {
        try {
          const [_, op, ...args] = body.split("|");
          switch (op) {
            case "new": {
              const full = (args[1] || "") + args[0]?.trim();
              sanitizePath(full);
              if (
                (
                  await env.DB.prepare("SELECT path FROM files WHERE path = ?")
                    .bind(full)
                    .all()
                ).results.length
              )
                throw new Error("文件已存在");
              await createNewFile(env, full);
              return json({ success: true, path: full });
            }
            case "newfolder": {
              let fn = args[0]?.trim();
              if (!fn) throw new Error("文件夹名不能为空");
              const full = (args[1] || "") + (fn.endsWith("/") ? fn : fn + "/");
              sanitizePath(full);
              if (
                (
                  await env.DB.prepare("SELECT path FROM files WHERE path = ?")
                    .bind(full)
                    .all()
                ).results.length
              )
                throw new Error("文件夹已存在");
              await createNewFolder(env, full);
              return json({ success: true, path: full });
            }
            case "delete": {
              const items = await deleteFile(env, args[0]);
              ctx.waitUntil(
                Promise.all(
                  items.map((t) => purgeCFCache(request, t.token, t.path)),
                ),
              );
              return text("删除成功");
            }
            case "rename": {
              const items = await renameFile(env, args[0], args[1]);
              ctx.waitUntil(
                Promise.all(
                  items.map((t) => purgeCFCache(request, t.token, t.path)),
                ),
              );
              return text("重命名成功");
            }
            case "move": {
              const items = await moveItem(env, args[0], args[1]);
              ctx.waitUntil(
                Promise.all(
                  (items || []).map((t) =>
                    purgeCFCache(request, t.token, t.path),
                  ),
                ),
              );
              return text("移动成功");
            }
            default:
              return text("未知操作", 400);
          }
        } catch (e) {
          return text(e.message, 400);
        }
      }
      if (
        request.method === "POST" &&
        !body.startsWith("FILE_TOKEN|") &&
        !body.startsWith("GET_TOKEN|") &&
        !body.startsWith("FILE_OP|") &&
        !body.startsWith("LOGIN|") &&
        !body.startsWith("LOGOUT")
      ) {
        let filename = decodeURIComponent(
          request.headers.get("X-File-Name") || "",
        );
        if (!filename) return text("缺少文件名", 400);
        sanitizePath(filename);
        const inlineToken = request.headers.get("X-File-Token")
          ? decodeURIComponent(request.headers.get("X-File-Token"))
          : null;
        const headerMime =
          request.headers.get("X-Content-Type") ||
          request.headers.get("Content-Type") ||
          mimeFromPath(filename);
        const mimeType = headerMime.split(";")[0].trim();
        const encodingHeader = (
          request.headers.get("X-Content-Encoding") || ""
        ).toLowerCase();
        let content = body;
        let encoding = "text";
        if (encodingHeader === "base64") {
          content = body.replace(/\s/g, "");
          encoding = "base64";
        } else if (isBinaryMime(mimeType) || mimeType === "application/octet-stream") {
          content = bytesToBase64(new Uint8Array(rawBody));
          encoding = "base64";
        }
        const used = await saveFileContent(env, filename, content, inlineToken, {
          mimeType,
          encoding,
        });
        if (used)
          ctx.waitUntil(
            putCFCache(request, used, filename, { content, mimeType, encoding }),
          );
        return text("保存成功");
      }
      if (url.searchParams.get("action") === "get_content") {
        const filePath = decodeURIComponent(url.searchParams.get("file") || "");
        const record = await getFileRecord(env, filePath);
        if (!record) return text("", 404);
        return responseFromStored(record.content, record.mimeType, record.encoding, filePath);
      }
      const frontendUrl = env.FRONTEND_URL || DEFAULT_FRONTEND_URL;
      return proxyFrontend(frontendUrl, request, ctx);
    }
    return text("Not Found", 404);
  },
};
