(() => {
  if (document.getElementById("skallstuggu-chat-host")) return;

  const host = document.createElement("div");
  host.id = "skallstuggu-chat-host";
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .launcher {
        position: fixed; right: 22px; bottom: 22px; z-index: 2147483000;
        border: 0; border-radius: 999px; padding: 14px 20px;
        background: #8b4a2b; color: #fff; box-shadow: 0 5px 22px #0003;
        font: 600 16px/1.2 Arial, sans-serif; cursor: pointer;
      }
      .launcher:focus-visible, button:focus-visible, input:focus-visible {
        outline: 3px solid #d9972b; outline-offset: 3px;
      }
      .panel {
        position: fixed; right: 22px; bottom: 84px; z-index: 2147483000;
        width: min(380px, calc(100vw - 28px)); height: min(520px, calc(100dvh - 120px));
        display: flex; flex-direction: column; overflow: hidden;
        border: 1px solid #e4d4c5; border-radius: 16px; background: #fffdf9;
        box-shadow: 0 12px 40px #0003; color: #29231f; font: 15px/1.45 Arial, sans-serif;
      }
      .panel[hidden] { display: none; }
      header { display:flex; align-items:center; justify-content:space-between; padding:15px 17px; background:#8b4a2b; color:white; }
      header strong { font-size:17px; }
      .close { border:0; background:transparent; color:white; font-size:24px; cursor:pointer; padding:0 4px; }
      .notice { margin:0; padding:9px 15px; background:#f8f1e3; font-size:12px; color:#57493e; }
      .messages { flex:1; overflow:auto; padding:14px; display:flex; flex-direction:column; gap:10px; }
      .bubble { max-width:88%; white-space:pre-wrap; overflow-wrap:anywhere; padding:10px 12px; border-radius:13px; }
      .bot { align-self:flex-start; background:#f2ebe4; }
      .user { align-self:flex-end; background:#8b4a2b; color:white; }
      form { display:flex; gap:8px; padding:12px; border-top:1px solid #e8ded5; }
      input { min-width:0; flex:1; border:1px solid #cdbdaf; border-radius:9px; padding:11px; font:inherit; }
      form button { border:0; border-radius:9px; padding:0 15px; background:#8b4a2b; color:white; font:600 14px Arial,sans-serif; cursor:pointer; }
      form button:disabled { opacity:.6; cursor:wait; }
      .status { min-height:18px; padding:0 13px 8px; font-size:12px; color:#62564c; }
      @media (max-width:480px) {
        .launcher { right:14px; bottom:14px; }
        .panel { right:10px; bottom:76px; height:min(520px, calc(100dvh - 100px)); width:calc(100vw - 20px); }
      }
    </style>
    <button class="launcher" type="button" aria-haspopup="dialog" aria-expanded="false">Spør Skallstuggu</button>
    <section class="panel" role="dialog" aria-label="Spør Skallstuggu" hidden>
      <header><strong>Spør Skallstuggu</strong><button class="close" type="button" aria-label="Lukk chat">×</button></header>
      <p class="notice">Testchat med AI. Den kan ta feil og kan ikke se bestillinger eller bekrefte ledige datoer.</p>
      <div class="messages" aria-live="polite">
        <div class="bubble bot">Hei! Jeg kan svare på spørsmål om Skallstuggu. For priser og ledige datoer, bruk bookingsiden.</div>
      </div>
      <div class="status" aria-live="polite"></div>
      <form><input name="message" maxlength="1000" autocomplete="off" placeholder="Skriv et spørsmål…" aria-label="Skriv et spørsmål" required><button type="submit">Send</button></form>
    </section>
  `;

  const launcher = root.querySelector(".launcher");
  const panel = root.querySelector(".panel");
  const close = root.querySelector(".close");
  const form = root.querySelector("form");
  const input = root.querySelector("input");
  const submit = root.querySelector('form button');
  const messagesEl = root.querySelector(".messages");
  const status = root.querySelector(".status");
  const conversation = [];

  function toggle(open) {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open) input.focus();
    else launcher.focus();
  }
  function addMessage(role, text) {
    const bubble = document.createElement("div");
    bubble.className = "bubble " + (role === "user" ? "user" : "bot");
    bubble.textContent = text;
    messagesEl.append(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  launcher.addEventListener("click", () => toggle(panel.hidden));
  close.addEventListener("click", () => toggle(false));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || submit.disabled) return;
    conversation.push({ role: "user", content: text });
    addMessage("user", text);
    input.value = "";
    submit.disabled = true;
    status.textContent = "Skriver svar…";
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation.slice(-8) }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.answer !== "string") throw new Error(data.error || "Kunne ikke hente svar.");
      conversation.push({ role: "assistant", content: data.answer });
      addMessage("assistant", data.answer);
      status.textContent = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Chatten er utilgjengelig.";
      status.textContent = message;
    } finally {
      submit.disabled = false;
      input.focus();
    }
  });
})();