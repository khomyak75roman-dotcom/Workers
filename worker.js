// ChatGPT MCP-плагін «Unlimited Image Gen»
// Без залежностей. Стейтлес Streamable-HTTP MCP сервер.
// Генерація: Pollinations.ai (безкоштовно, без ключа).

const SERVER = { name: "unlimited-image-gen", version: "1.0.0" };

const TOOLS = [
  {
    name: "generate_image",
    description:
      "Generate an image from a text prompt. Free and unlimited. " +
      "Returns the generated image itself and a permanent public URL of it. " +
      "Write prompts in English for best quality. Always enrich the user's " +
      "request into a detailed English prompt before calling this tool.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed image prompt in English" },
        width:  { type: "integer", description: "Image width, default 1024" },
        height: { type: "integer", description: "Image height, default 1024" },
        seed:   { type: "integer", description: "Optional seed to reproduce an image" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "list_models",
    description: "List image models available on the current free tier.",
    inputSchema: { type: "object", properties: {} },
  },
];

function rpc(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcErr(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function generateImage(args, env) {
  const prompt = String(args.prompt || "").trim().slice(0, 2000);
  if (!prompt) throw new Error("prompt is required");

  const q = new URLSearchParams();
  q.set("width", String(args.width || 1024));
  q.set("height", String(args.height || 1024));
  if (args.seed !== undefined && args.seed !== null) q.set("seed", String(args.seed));

  // Без ключа — легасі-ендпоінт (безкоштовно, з водяним знаком).
  // З ключем — новий gen-ендпоінт (Seed-рівень: швидше, без watermark).
  let imageUrl;
  if (env && env.POLLINATIONS_KEY) {
    imageUrl = "https://gen.pollinations.ai/image/" + encodeURIComponent(prompt)
      + "?" + q + "&key=" + encodeURIComponent(env.POLLINATIONS_KEY);
  } else {
    imageUrl = "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt)
      + "?" + q;
  }

  const res = await fetch(imageUrl);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error("Pollinations error " + res.status + ": " + t.slice(0, 200));
  }

  const data = toBase64(await res.arrayBuffer());
  return {
    content: [
      {
        type: "image",
        data,
        mimeType: res.headers.get("content-type") || "image/jpeg",
      },
      {
        type: "text",
        text: "Зображення згенеровано. Постійне посилання: " + imageUrl,
      },
    ],
  };
}

async function listModels() {
  const res = await fetch("https://image.pollinations.ai/models");
  const models = await res.json();
  return { content: [{ type: "text", text: "Доступні моделі: " + JSON.stringify(models) }] };
}

async function handleMessage(msg, env) {
  // нотифікації (без id) не потребують відповіді
  if (msg.id === undefined || msg.id === null) return null;

  switch (msg.method) {
    case "initialize":
      return rpc(msg.id, {
        protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: SERVER,
      });
    case "ping":
      return rpc(msg.id, {});
    case "tools/list":
      return rpc(msg.id, { tools: TOOLS });
    case "tools/call": {
      const { name, arguments: args = {} } = msg.params || {};
      try {
        if (name === "generate_image") return rpc(msg.id, await generateImage(args, env));
        if (name === "list_models") return rpc(msg.id, await listModels());
        return rpcErr(msg.id, -32601, "Unknown tool: " + name);
      } catch (e) {
        return {
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: [{ type: "text", text: "Помилка: " + e.message }], isError: true },
        };
      }
    }
    default:
      return rpcErr(msg.id, -32601, "Method not found: " + msg.method);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", server: SERVER.name });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify(rpcErr(null, -32700, "Parse error")), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const batch = Array.isArray(body);
    const msgs = batch ? body : [body];
    const replies = [];

    for (const msg of msgs) {
      const reply = await handleMessage(msg, env);
      if (reply) replies.push(reply);
    }

    if (replies.length === 0) return new Response(null, { status: 202 });

    const payload = batch ? replies : replies[0];
    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
