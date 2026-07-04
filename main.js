import * as webllm from "https://code4fukui.github.io/web-llm/web-llm.js";

const DB_NAME = "local-llm-chat";
const DB_VERSION = 1;
const STORE = {
  messages: "messages",
  settings: "settings",
};
const WEBLLM_CACHE_NAMES = ["webllm/config", "webllm/wasm", "webllm/model"];

const MODEL_LIB_BASE =
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base";
const GEMMA_3_4B_MODEL_ID = "gemma-3-4b-it-q4f16_1-MLC";
const GEMMA_3_4B_MODEL_URL =
  "https://huggingface.co/mlc-ai/gemma-3-4b-it-q4f16_1-MLC";
const GEMMA_3_4B_UNAVAILABLE_LIBS = [
  "gemma-3-4b-it-q4f16_1-webgpu.wasm",
  "gemma-3-4b-it-q4f16_1_cs1k-webgpu.wasm",
];
const GEMMA_3_4B_WEBGPU_MESSAGE =
  "Gemma 3 4B weights exist, but WebLLM v0_2_84 does not publish a matching WebGPU WASM. Build one with MLC-LLM or choose another WebLLM prebuilt model.";
const DEFAULT_PRESET = "qwen4b";

const presets = {
  gemma: {
    modelId: "gemma3-1b-it-q4f16_1-MLC",
    modelUrl: "https://huggingface.co/mlc-ai/gemma3-1b-it-q4f16_1-MLC",
    modelLib: `${MODEL_LIB_BASE}/gemma3-1b-it-q4f16_1_cs1k-webgpu.wasm`,
    context: 4096,
    maxTokens: 512,
    temperature: 0.7,
    topP: 0.9,
  },
  gemma4b: {
    modelId: GEMMA_3_4B_MODEL_ID,
    modelUrl: GEMMA_3_4B_MODEL_URL,
    modelLib: "",
    context: 4096,
    maxTokens: 512,
    temperature: 0.7,
    topP: 0.9,
  },
  qwen4b: {
    modelId: "Qwen3-4B-q4f16_1-MLC",
    modelUrl: "",
    modelLib: "",
    context: 4096,
    maxTokens: 2048,
    temperature: 0.7,
    topP: 0.9,
  },
  "llama-small": {
    modelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    modelUrl: "",
    modelLib: "",
    context: 4096,
    maxTokens: 512,
    temperature: 0.7,
    topP: 0.9,
  },
  custom: {
    modelId: "",
    modelUrl: "",
    modelLib: "",
    context: 4096,
    maxTokens: 512,
    temperature: 0.7,
    topP: 0.9,
  },
};

const els = {
  webgpuBadge: document.querySelector("#webgpuBadge"),
  presetSelect: document.querySelector("#presetSelect"),
  modelIdInput: document.querySelector("#modelIdInput"),
  modelUrlInput: document.querySelector("#modelUrlInput"),
  modelLibInput: document.querySelector("#modelLibInput"),
  contextInput: document.querySelector("#contextInput"),
  maxTokensInput: document.querySelector("#maxTokensInput"),
  temperatureInput: document.querySelector("#temperatureInput"),
  topPInput: document.querySelector("#topPInput"),
  loadButton: document.querySelector("#loadButton"),
  clearButton: document.querySelector("#clearButton"),
  clearIndexedDbButton: document.querySelector("#clearIndexedDbButton"),
  progressBar: document.querySelector("#progressBar"),
  statusText: document.querySelector("#statusText"),
  messages: document.querySelector("#messages"),
  chatForm: document.querySelector("#chatForm"),
  promptInput: document.querySelector("#promptInput"),
  sendButton: document.querySelector("#sendButton"),
  stopButton: document.querySelector("#stopButton"),
};

let db;
let engine;
let messages = [];
let abortController;
let activeAssistantId;

init().catch((error) => setStatus(error.message, 0));

async function init() {
  db = await openDb();
  await checkWebGpu();
  const savedSettings = await getSetting("settings");
  applySettings(normalizeSettings(savedSettings));
  messages = await getMessages();
  renderMessages();
  bindEvents();
}

function bindEvents() {
  els.presetSelect.addEventListener("change", () => {
    const preset = presets[els.presetSelect.value];
    applySettings(preset);
  });

  for (const input of [
    els.modelIdInput,
    els.modelUrlInput,
    els.modelLibInput,
    els.contextInput,
    els.maxTokensInput,
    els.temperatureInput,
    els.topPInput,
  ]) {
    input.addEventListener("change", persistSettings);
  }

  els.loadButton.addEventListener("click", loadModel);
  els.clearButton.addEventListener("click", clearChat);
  els.clearIndexedDbButton.addEventListener("click", clearIndexedDbData);
  els.stopButton.addEventListener("click", stopGeneration);
  els.chatForm.addEventListener("submit", sendMessage);
  els.promptInput.addEventListener("input", autoGrow);
  els.promptInput.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.chatForm.requestSubmit();
    }
  });
}

async function checkWebGpu() {
  if (!("gpu" in navigator)) {
    els.webgpuBadge.textContent = "no WebGPU";
    els.webgpuBadge.className = "badge bad";
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    els.webgpuBadge.textContent = "no adapter";
    els.webgpuBadge.className = "badge bad";
    return;
  }

  els.webgpuBadge.textContent = "WebGPU ready";
  els.webgpuBadge.className = "badge ok";
}

function currentSettings() {
  return {
    modelId: els.modelIdInput.value.trim(),
    modelUrl: els.modelUrlInput.value.trim(),
    modelLib: els.modelLibInput.value.trim(),
    context: Number(els.contextInput.value),
    maxTokens: Number(els.maxTokensInput.value),
    temperature: Number(els.temperatureInput.value),
    topP: Number(els.topPInput.value),
  };
}

function applySettings(settings) {
  els.modelIdInput.value = settings.modelId;
  els.modelUrlInput.value = settings.modelUrl;
  els.modelLibInput.value = settings.modelLib;
  els.contextInput.value = settings.context;
  els.maxTokensInput.value = settings.maxTokens;
  els.temperatureInput.value = settings.temperature;
  els.topPInput.value = settings.topP;
  persistSettings();
}

function normalizeSettings(settings) {
  const defaultSettings = presets[DEFAULT_PRESET];

  if (!settings) return defaultSettings;

  if (hasUnavailableGemma34bLib(settings.modelLib)) {
    return defaultSettings;
  }

  return {
    ...defaultSettings,
    ...settings,
  };
}

async function persistSettings() {
  if (!db) return;
  await putSetting("settings", currentSettings());
}

async function loadModel() {
  const settings = currentSettings();
  if (!settings.modelId) {
    setStatus("Model ID is required", 0);
    return;
  }

  if (settings.modelId === "gemma3:4b") {
    setStatus(
      "gemma3:4b is an Ollama tag. WebLLM needs an MLC model URL and matching WebGPU WASM.",
      0,
    );
    return;
  }

  if (
    isGemma34b(settings) &&
    (!settings.modelLib || hasUnavailableGemma34bLib(settings.modelLib))
  ) {
    setStatus(GEMMA_3_4B_WEBGPU_MESSAGE, 0);
    return;
  }

  if (!settings.modelUrl || !settings.modelLib) {
    const prebuilt = webllm.prebuiltAppConfig.model_list.find(
      (model) => model.model_id === settings.modelId,
    );
    if (!prebuilt) {
      setStatus("Custom MLC models need both Model URL and WebGPU WASM", 0);
      return;
    }
  }

  setBusy(true);
  setStatus("Loading model", 0.02);

  try {
    const appConfig = buildAppConfig(settings);
    engine?.unload?.();
    engine = await webllm.CreateMLCEngine(
      settings.modelId,
      {
        appConfig,
        initProgressCallback: (progress) => {
          const percent = progress.progress ?? 0;
          setStatus(progress.text ?? "Loading model", percent);
        },
        logLevel: "INFO",
      },
      {
        context_window_size: settings.context,
        sliding_window_size: -1,
      },
    );
    setStatus("Model loaded", 1);
    els.promptInput.disabled = false;
    els.sendButton.disabled = false;
    els.promptInput.focus();
  } catch (error) {
    setStatus(error.message, 0);
  } finally {
    setBusy(false);
  }
}

function isGemma34b(settings) {
  return (
    settings.modelId === GEMMA_3_4B_MODEL_ID ||
    settings.modelUrl === GEMMA_3_4B_MODEL_URL
  );
}

function hasUnavailableGemma34bLib(modelLib) {
  return GEMMA_3_4B_UNAVAILABLE_LIBS.some((fileName) =>
    modelLib?.includes(fileName),
  );
}

function buildAppConfig(settings) {
  const prebuilt = webllm.prebuiltAppConfig.model_list.find(
    (model) => model.model_id === settings.modelId,
  );

  if (prebuilt && !settings.modelUrl && !settings.modelLib) {
    return {
      ...webllm.prebuiltAppConfig,
      cacheBackend: webLlmCacheBackend(),
    };
  }

  return {
    cacheBackend: webLlmCacheBackend(),
    model_list: [
      {
        model: settings.modelUrl,
        model_id: settings.modelId,
        model_lib: settings.modelLib,
        required_features: ["shader-f16"],
        overrides: {
          context_window_size: settings.context,
          sliding_window_size: -1,
        },
      },
    ],
  };
}

async function sendMessage(event) {
  event.preventDefault();
  const text = els.promptInput.value.trim();
  if (!text || !engine) return;

  const userMessage = createMessage("user", text);
  const assistantMessage = createMessage("assistant", "");
  messages.push(userMessage, assistantMessage);
  await saveMessage(userMessage);
  await saveMessage(assistantMessage);
  activeAssistantId = assistantMessage.id;
  renderMessages();

  els.promptInput.value = "";
  autoGrow();
  setGenerating(true);
  abortController = new AbortController();

  try {
    let finishReason = null;
    const stream = await engine.chat.completions.create({
      messages: toChatMessages(messages),
      stream: true,
      max_tokens: Number(els.maxTokensInput.value),
      temperature: Number(els.temperatureInput.value),
      top_p: Number(els.topPInput.value),
    });

    for await (const chunk of stream) {
      if (abortController.signal.aborted) break;
      finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        assistantMessage.content += delta;
        await saveMessage(assistantMessage);
        updateMessageNode(assistantMessage);
      }
    }

    if (finishReason === "length") {
      assistantMessage.content +=
        "\n\n[出力上限に達したため停止しました。Max tokens を増やしてください。]";
      await saveMessage(assistantMessage);
      updateMessageNode(assistantMessage);
    }
  } catch (error) {
    assistantMessage.content += `\n\n[error] ${error.message}`;
    await saveMessage(assistantMessage);
    updateMessageNode(assistantMessage);
  } finally {
    setGenerating(false);
    activeAssistantId = null;
    abortController = null;
  }
}

function stopGeneration() {
  abortController?.abort();
  engine?.interruptGenerate?.();
  setGenerating(false);
}

async function clearChat() {
  messages = [];
  await clearStore(STORE.messages);
  renderMessages();
}

async function clearIndexedDbData() {
  const confirmed = confirm(
    "チャット履歴、設定、モデルキャッシュを削除します。よろしいですか？",
  );
  if (!confirmed) return;

  stopGeneration();
  setBusy(true);
  setStatus("Clearing storage", 0.1);

  try {
    engine?.unload?.();
    engine = null;
    db?.close();
    db = null;
    messages = [];
    const deleteResults = await Promise.all([
      deleteDatabase(DB_NAME),
      ...WEBLLM_CACHE_NAMES.map((dbName) => deleteDatabase(dbName)),
    ]);
    await clearWebLlmCacheStorage();
    db = await openDb();
    applySettings(presets[DEFAULT_PRESET]);
    renderMessages();
    els.promptInput.disabled = true;
    els.sendButton.disabled = true;
    const blockedNames = deleteResults
      .filter((result) => result.blocked)
      .map((result) => result.dbName);
    setStatus(
      blockedNames.length
        ? `Storage cleared where possible. Blocked: ${blockedNames.join(", ")}. Reload or close other tabs, then clear again.`
        : "Storage cleared. Load the model again.",
      blockedNames.length ? 0.65 : 1,
    );
  } catch (error) {
    setStatus(
      `Failed to clear storage: ${error.message}. Close other tabs using this app and try again.`,
      0,
    );
  } finally {
    setBusy(false);
  }
}

function createMessage(role, content) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
  };
}

function toChatMessages(items) {
  return items
    .filter((message) => message.content.trim())
    .map(({ role, content }) => ({ role, content }));
}

function renderMessages() {
  els.messages.innerHTML = "";
  if (messages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      "Load the model, then start chatting locally in this browser.";
    els.messages.append(empty);
    return;
  }

  for (const message of messages) {
    els.messages.append(messageNode(message));
  }
  scrollMessages();
}

function messageNode(message) {
  const node = document.createElement("article");
  node.className = `message ${message.role}`;
  node.dataset.id = message.id;
  node.innerHTML = `<span class="role"></span><span class="content"></span>`;
  node.querySelector(".role").textContent = message.role;
  node.querySelector(".content").textContent = message.content || " ";
  return node;
}

function updateMessageNode(message) {
  const node = els.messages.querySelector(`[data-id="${message.id}"]`);
  if (!node) {
    renderMessages();
    return;
  }
  node.querySelector(".content").textContent = message.content || " ";
  scrollMessages();
}

function scrollMessages() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function setStatus(text, progress) {
  els.statusText.textContent = text;
  els.progressBar.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
}

function setBusy(isBusy) {
  els.loadButton.disabled = isBusy;
  els.clearIndexedDbButton.disabled = isBusy;
}

function setGenerating(isGenerating) {
  els.sendButton.disabled = isGenerating;
  els.stopButton.disabled = !isGenerating;
  els.promptInput.disabled = isGenerating;
}

function autoGrow() {
  els.promptInput.style.height = "auto";
  els.promptInput.style.height = `${els.promptInput.scrollHeight}px`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE.messages)) {
        database.createObjectStore(STORE.messages, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(STORE.settings)) {
        database.createObjectStore(STORE.settings);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function webLlmCacheBackend() {
  return isAppleMobileBrowser() ? "cache" : "indexeddb";
}

function isAppleMobileBrowser() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

async function clearWebLlmCacheStorage() {
  if (!("caches" in window)) return;
  await Promise.all(WEBLLM_CACHE_NAMES.map((cacheName) => caches.delete(cacheName)));
}

function deleteDatabase(dbName) {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve({ dbName, deleted: true, blocked: false });
    request.onerror = () =>
      resolve({
        dbName,
        deleted: false,
        blocked: false,
        error: request.error?.message ?? "unknown error",
      });
    request.onblocked = () =>
      resolve({ dbName, deleted: false, blocked: true });
  });
}

async function getMessages() {
  const items = await requestToPromise(tx(STORE.messages).getAll());
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

function saveMessage(message) {
  return requestToPromise(tx(STORE.messages, "readwrite").put(message));
}

function getSetting(key) {
  return requestToPromise(tx(STORE.settings).get(key));
}

function putSetting(key, value) {
  return requestToPromise(tx(STORE.settings, "readwrite").put(value, key));
}

function clearStore(storeName) {
  return requestToPromise(tx(storeName, "readwrite").clear());
}
