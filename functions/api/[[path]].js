const SESSION_COOKIE = "siqi_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const MAX_STUDENTS = 200;
const encoder = new TextEncoder();

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      ...extraHeaders
    }
  });
}

function fail(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

function methodNotAllowed(allow) {
  return json(
    { ok: false, error: "Method not allowed" },
    405,
    { Allow: allow }
  );
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hashText(value) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value))
  );
}

function constantTimeEqual(left, right) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

async function passwordMatches(input, expected) {
  if (!input || !expected) {
    return false;
  }
  const [left, right] = await Promise.all([
    hashText(input),
    hashText(expected)
  ]);
  return constantTimeEqual(left, right);
}

function parseCookies(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const result = {};
  cookieHeader.split(";").forEach((chunk) => {
    const separator = chunk.indexOf("=");
    if (separator < 0) {
      return;
    }
    const key = chunk.slice(0, separator).trim();
    const value = chunk.slice(separator + 1).trim();
    if (key) {
      result[key] = value;
    }
  });
  return result;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function createSession(env) {
  const payload = bytesToBase64Url(
    encoder.encode(JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
      nonce: crypto.randomUUID()
    }))
  );
  const signature = await hmac(payload, env.SESSION_SECRET);
  return `${payload}.${signature}`;
}

async function verifySession(request, env) {
  if (!env.SESSION_SECRET) {
    return false;
  }
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) {
    return false;
  }
  const separator = token.lastIndexOf(".");
  if (separator <= 0) {
    return false;
  }
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = await hmac(payload, env.SESSION_SECRET);
  if (!constantTimeEqual(encoder.encode(signature), encoder.encode(expected))) {
    return false;
  }
  try {
    const decoded = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payload))
    );
    return Number.isFinite(decoded.exp) && decoded.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

function sessionCookie(request, token) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}${secure}`;
}

function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return true;
  }
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 300000) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }
  const text = await request.text();
  if (text.length > 300000) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function cleanLine(line) {
  return line
    .trim()
    .replace(/^(?:\d{1,3}[.、)．]\s*|[-*•·]\s*)/, "")
    .trim();
}

function parseStudents(input) {
  const source = Array.isArray(input)
    ? input.join("\n")
    : typeof input === "string"
      ? input
      : "";
  const names = [];
  const seen = new Set();
  source.split(/\r?\n/).forEach((line) => {
    const name = cleanLine(String(line)).slice(0, 40);
    if (!name || seen.has(name)) {
      return;
    }
    seen.add(name);
    names.push(name);
  });
  return names.slice(0, MAX_STUDENTS);
}

function parseClassBody(body) {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 50) : "";
  const description = typeof body.description === "string"
    ? body.description.trim().slice(0, 160)
    : "";
  const sortOrderRaw = Number(body.sort_order);
  const sortOrder = Number.isFinite(sortOrderRaw)
    ? Math.max(-9999, Math.min(9999, Math.trunc(sortOrderRaw)))
    : 0;
  const students = parseStudents(body.students);
  return { name, description, sortOrder, students };
}

async function getClasses(env) {
  const response = await env.DB.prepare(
    `SELECT c.id, c.name, c.description, c.sort_order, c.updated_at,
      COUNT(s.id) AS student_count
     FROM classes c
     LEFT JOIN students s ON s.class_id = c.id
     GROUP BY c.id
     ORDER BY c.sort_order ASC, c.id ASC`
  ).all();
  return response.results || [];
}

async function getClass(env, id) {
  const classRow = await env.DB.prepare(
    `SELECT id, name, description, sort_order, updated_at
     FROM classes WHERE id = ?`
  ).bind(id).first();
  if (!classRow) {
    return null;
  }
  const students = await env.DB.prepare(
    `SELECT name FROM students
     WHERE class_id = ?
     ORDER BY sort_order ASC, id ASC`
  ).bind(id).all();
  return {
    ...classRow,
    students: (students.results || []).map((row) => row.name)
  };
}

async function replaceStudents(env, classId, students) {
  const statements = [
    env.DB.prepare("DELETE FROM students WHERE class_id = ?").bind(classId)
  ];
  if (students.length) {
    const placeholders = students.map(() => "(?, ?, ?)").join(",");
    const values = [];
    students.forEach((name, index) => {
      values.push(classId, name, index);
    });
    statements.push(
      env.DB.prepare(
        `INSERT INTO students (class_id, name, sort_order) VALUES ${placeholders}`
      ).bind(...values)
    );
  }
  await env.DB.batch(statements);
}

async function createClass(env, payload) {
  const created = await env.DB.prepare(
    `INSERT INTO classes (name, description, sort_order)
     VALUES (?, ?, ?) RETURNING id`
  ).bind(payload.name, payload.description, payload.sortOrder).first();
  const id = Number(created.id);
  try {
    await replaceStudents(env, id, payload.students);
  } catch (error) {
    await env.DB.prepare("DELETE FROM classes WHERE id = ?").bind(id).run();
    throw error;
  }
  return id;
}

async function updateClass(env, id, payload) {
  const result = await env.DB.prepare(
    `UPDATE classes
     SET name = ?, description = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(payload.name, payload.description, payload.sortOrder, id).run();
  if (!result.meta || result.meta.changes === 0) {
    return false;
  }
  await replaceStudents(env, id, payload.students);
  return true;
}

async function requireAdmin(request, env) {
  if (!(await verifySession(request, env))) {
    return fail("请先登录", 401);
  }
  return null;
}

function apiPath(url) {
  return url.pathname
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (!env.DB) {
    return fail("D1 数据库尚未绑定，请在 Pages 项目中绑定 DB", 500);
  }

  const url = new URL(request.url);
  const parts = apiPath(url);
  const method = request.method;

  try {
    if (parts[0] === "classes" && parts.length === 1) {
      if (method !== "GET") {
        return methodNotAllowed("GET");
      }
      return json({ ok: true, classes: await getClasses(env) });
    }

    if (parts[0] === "classes" && parts.length === 2) {
      if (method !== "GET") {
        return methodNotAllowed("GET");
      }
      const id = Number(parts[1]);
      if (!Number.isInteger(id) || id <= 0) {
        return fail("班级编号无效", 400);
      }
      const classData = await getClass(env, id);
      if (!classData) {
        return fail("班级不存在", 404);
      }
      return json({ ok: true, class: classData });
    }

    if (parts[0] === "auth" && parts[1] === "me" && parts.length === 2) {
      if (method !== "GET") {
        return methodNotAllowed("GET");
      }
      return json({ ok: true, authenticated: await verifySession(request, env) });
    }

    if (parts[0] === "auth" && parts[1] === "login" && parts.length === 2) {
      if (method !== "POST") {
        return methodNotAllowed("POST");
      }
      if (!sameOrigin(request)) {
        return fail("请求来源无效", 403);
      }
      if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
        return fail("后台密码或会话密钥尚未配置", 500);
      }
      if (env.SESSION_SECRET.length < 32) {
        return fail("SESSION_SECRET 至少需要 32 个字符", 500);
      }
      const body = await readJson(request);
      if (!(await passwordMatches(String(body.password || ""), env.ADMIN_PASSWORD))) {
        return fail("密码不正确", 401);
      }
      const token = await createSession(env);
      return json(
        { ok: true },
        200,
        { "Set-Cookie": sessionCookie(request, token) }
      );
    }

    if (parts[0] === "auth" && parts[1] === "logout" && parts.length === 2) {
      if (method !== "POST") {
        return methodNotAllowed("POST");
      }
      return json(
        { ok: true },
        200,
        { "Set-Cookie": clearSessionCookie(request) }
      );
    }

    if (parts[0] === "admin" && parts[1] === "classes") {
      const unauthorized = await requireAdmin(request, env);
      if (unauthorized) {
        return unauthorized;
      }
      if (!sameOrigin(request)) {
        return fail("请求来源无效", 403);
      }

      if (parts.length === 2 && method === "GET") {
        return json({ ok: true, classes: await getClasses(env) });
      }

      if (parts.length === 2 && method === "POST") {
        const body = await readJson(request);
        const payload = parseClassBody(body);
        if (!payload.name) {
          return fail("请填写班级名称", 400);
        }
        const id = await createClass(env, payload);
        return json({ ok: true, id, class: await getClass(env, id) }, 201);
      }

      if (parts.length === 3) {
        const id = Number(parts[2]);
        if (!Number.isInteger(id) || id <= 0) {
          return fail("班级编号无效", 400);
        }

        if (method === "PUT") {
          const body = await readJson(request);
          const payload = parseClassBody(body);
          if (!payload.name) {
            return fail("请填写班级名称", 400);
          }
          const updated = await updateClass(env, id, payload);
          if (!updated) {
            return fail("班级不存在", 404);
          }
          return json({ ok: true, class: await getClass(env, id) });
        }

        if (method === "DELETE") {
          const result = await env.DB.prepare(
            "DELETE FROM classes WHERE id = ?"
          ).bind(id).run();
          if (!result.meta || result.meta.changes === 0) {
            return fail("班级不存在", 404);
          }
          return json({ ok: true });
        }

        return methodNotAllowed("PUT, DELETE");
      }
    }

    return fail("接口不存在", 404);
  } catch (error) {
    if (error.message === "INVALID_JSON") {
      return fail("请求内容不是有效 JSON", 400);
    }
    if (error.message === "PAYLOAD_TOO_LARGE") {
      return fail("内容过大", 413);
    }
    console.error(error);
    return fail("服务器暂时出错，请稍后重试", 500);
  }
}
