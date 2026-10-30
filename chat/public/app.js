const form = document.querySelector("#chat-form");
const input = document.querySelector("#question");
const messagesEl = document.querySelector("#messages");
const sendButton = document.querySelector("#send");
const history = [];

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function formatAnswer(value) {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1 ↗</a>')
    .replace(/\n/g, "<br>");
}

function addMessage(role, text, pending = false) {
  const row = document.createElement("div");
  row.className = `message ${role}`;
  if (role === "assistant") {
    const icon = document.createElement("span");
    icon.className = "assistant-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "E";
    row.append(icon);
  }
  const bubble = document.createElement("div");
  bubble.className = `bubble${pending ? " pending" : ""}`;
  if (role === "assistant" && !pending) bubble.innerHTML = formatAnswer(text);
  else bubble.textContent = text;
  row.append(bubble);
  messagesEl.append(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

async function submitQuestion(question) {
  if (!question || sendButton.disabled) return;
  history.push({ role: "user", content: question });
  addMessage("user", question);
  input.value = "";
  input.style.height = "auto";
  sendButton.disabled = true;
  const pending = addMessage("assistant", "Keresek az EKKE forrásai között…", true);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Nem sikerült választ kérni.");
    history.push({ role: "assistant", content: payload.answer });
    pending.classList.remove("pending");
    pending.innerHTML = formatAnswer(payload.answer);
  } catch (error) {
    pending.classList.remove("pending");
    pending.textContent = error instanceof Error ? error.message : "Hiba történt.";
  } finally {
    sendButton.disabled = false;
    input.focus();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitQuestion(input.value.trim());
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => void submitQuestion(button.textContent.trim()));
});
