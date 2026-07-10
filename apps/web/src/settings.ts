export type ThemeMode = "system" | "light" | "dark";
export type AccentColor = "clay" | "graphite" | "sage";
export type PdfBackground = "paper" | "plain" | "soft";
export type PdfViewMode = "continuous" | "single-page";
export type FontScale = "compact" | "default" | "large";
export type ScrollbarStyle = "thin" | "subtle" | "native";
export type Language = "zh-CN" | "en-US";
export type ExplanationLanguage = "auto" | Language;
export type ModelReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export type AgentAnswerMode = "concise" | "guided" | "detailed";
export type ApiProviderType =
  | "codex-oauth"
  | "openai-compatible"
  | "openai-chat-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generate-content"
  | "ollama-chat";

export type ModelRef = {
  providerId: string;
  model: string;
};

export type ModelApiProvider = {
  id: string;
  presetProviderId?: string;
  name: string;
  description?: string;
  type: ApiProviderType;
  defaultChatEndpoint?: ApiProviderType;
  endpointConfigs?: Record<string, {
    baseUrl?: string;
    modelsApiUrls?: Record<string, string>;
    reasoningFormatType?: string;
    adapterFamily?: string;
  }>;
  apiHost: string;
  apiKey?: string;
  hasApiKey?: boolean;
  apiKeyRequired: boolean;
  enabled: boolean;
  models: string[];
  apiFeatures?: Record<string, unknown>;
  websites?: {
    official?: string;
    docs?: string;
    apiKey?: string;
    models?: string;
  };
  catalog?: {
    source?: string;
    versions?: Record<string, string>;
  };
};

export type ModelApiConfig = {
  version: number;
  catalog?: {
    source?: string;
    versions?: Record<string, string>;
  };
  selectedProviderId: string;
  providers: ModelApiProvider[];
  defaults: {
    assistant: ModelRef;
    teachingFast: ModelRef;
    teachingBalanced: ModelRef;
    teachingQuality: ModelRef;
  };
};

export type UiPreferences = {
  language: Language;
  explanationLanguage: ExplanationLanguage;
  modelReasoningEffort: ModelReasoningEffort;
  agentAnswerMode: AgentAnswerMode;
  autoSaveSession: boolean;
  theme: ThemeMode;
  accentColor: AccentColor;
  pdfBackground: PdfBackground;
  pdfViewMode: PdfViewMode;
  fontScale: FontScale;
  compactMode: boolean;
  showSourcePills: boolean;
  pageAwareSuggestions: boolean;
  pdfContextFullPageLimit: number;
  pdfContextEdgePageCount: number;
  scrollbarStyle: ScrollbarStyle;
  debugMode: boolean;
};

export const uiPreferencesStorageKey = "synchropage.uiPreferences.v1";

export const defaultUiPreferences: UiPreferences = {
  language: "zh-CN",
  explanationLanguage: "auto",
  modelReasoningEffort: "medium",
  agentAnswerMode: "concise",
  autoSaveSession: true,
  theme: "dark",
  accentColor: "clay",
  pdfBackground: "paper",
  pdfViewMode: "continuous",
  fontScale: "default",
  compactMode: false,
  showSourcePills: true,
  pageAwareSuggestions: true,
  pdfContextFullPageLimit: 50,
  pdfContextEdgePageCount: 10,
  scrollbarStyle: "thin",
  debugMode: false,
};

export const defaultModelApiConfig: ModelApiConfig = {
  version: 2,
  catalog: undefined,
  selectedProviderId: "codex_oauth",
  providers: [
    {
      id: "codex_oauth",
      name: "OpenAI OAuth",
      type: "codex-oauth",
      apiHost: "https://chatgpt.com/backend-api/codex/",
      apiKeyRequired: false,
      enabled: true,
      models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
    },
    {
      id: "openai_api",
      name: "OpenAI API Key",
      type: "openai-responses",
      apiHost: "https://api.openai.com/v1",
      apiKeyRequired: true,
      enabled: false,
      models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      type: "openai-compatible",
      apiHost: "https://api.deepseek.com",
      apiKeyRequired: true,
      enabled: false,
      models: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      type: "openai-compatible",
      apiHost: "https://openrouter.ai/api/v1",
      apiKeyRequired: true,
      enabled: false,
      models: ["openai/gpt-4.1", "anthropic/claude-sonnet-4", "deepseek/deepseek-chat"],
    },
    {
      id: "siliconflow",
      name: "SiliconFlow",
      type: "openai-compatible",
      apiHost: "https://api.siliconflow.cn/v1",
      apiKeyRequired: true,
      enabled: false,
      models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"],
    },
    {
      id: "ollama",
      name: "Ollama",
      type: "openai-compatible",
      apiHost: "http://127.0.0.1:11434/v1",
      apiKeyRequired: false,
      enabled: false,
      models: ["llama3.1", "qwen2.5"],
    },
  ],
  defaults: {
    assistant: { providerId: "codex_oauth", model: "gpt-5.6-sol" },
    teachingFast: { providerId: "codex_oauth", model: "gpt-5.6-luna" },
    teachingBalanced: { providerId: "codex_oauth", model: "gpt-5.6-terra" },
    teachingQuality: { providerId: "codex_oauth", model: "gpt-5.6-sol" },
  },
};

export function loadUiPreferences() {
  if (typeof window === "undefined") return defaultUiPreferences;
  try {
    const stored = window.localStorage.getItem(uiPreferencesStorageKey);
    if (!stored) return defaultUiPreferences;
    const merged = { ...defaultUiPreferences, ...(JSON.parse(stored) as Partial<UiPreferences>) };
    const pdfViewMode: PdfViewMode = merged.pdfViewMode === "single-page" ? "single-page" : "continuous";
    return {
      ...merged,
      language: normalizeLanguage(merged.language),
      explanationLanguage: normalizeExplanationLanguage(merged.explanationLanguage),
      modelReasoningEffort: normalizeModelReasoningEffort(merged.modelReasoningEffort),
      agentAnswerMode: normalizeAgentAnswerMode(merged.agentAnswerMode),
      pdfViewMode,
      pdfContextFullPageLimit: clampNumber(merged.pdfContextFullPageLimit, defaultUiPreferences.pdfContextFullPageLimit, 1, 500),
      pdfContextEdgePageCount: clampNumber(merged.pdfContextEdgePageCount, defaultUiPreferences.pdfContextEdgePageCount, 1, 100),
    };
  } catch {
    return defaultUiPreferences;
  }
}

export function normalizeLanguage(value: unknown): Language {
  return value === "en-US" ? "en-US" : "zh-CN";
}

export function normalizeExplanationLanguage(value: unknown): ExplanationLanguage {
  return value === "zh-CN" || value === "en-US" ? value : "auto";
}

export function normalizeModelReasoningEffort(value: unknown): ModelReasoningEffort {
  return value === "none" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max" ? value : "medium";
}

export function normalizeAgentAnswerMode(value: unknown): AgentAnswerMode {
  return value === "guided" || value === "detailed" ? value : "concise";
}

export function normalizeModelApiConfig(value: unknown): ModelApiConfig {
  const source = (value && typeof value === "object" ? value : {}) as Partial<ModelApiConfig>;
  const providers = Array.isArray(source.providers) && source.providers.length
    ? source.providers.map((provider, index) => normalizeModelApiProvider(provider, index))
    : defaultModelApiConfig.providers;
  const selectedProviderId = providers.some((provider) => provider.id === source.selectedProviderId)
    ? String(source.selectedProviderId)
    : providers[0]?.id || defaultModelApiConfig.selectedProviderId;
  return {
    version: 2,
    catalog: isPlainRecord(source.catalog) ? source.catalog as ModelApiConfig["catalog"] : undefined,
    selectedProviderId,
    providers,
    defaults: {
      assistant: normalizeModelRef(source.defaults?.assistant, providers, defaultModelApiConfig.defaults.assistant),
      teachingFast: normalizeModelRef(source.defaults?.teachingFast, providers, defaultModelApiConfig.defaults.teachingFast),
      teachingBalanced: normalizeModelRef(source.defaults?.teachingBalanced, providers, defaultModelApiConfig.defaults.teachingBalanced),
      teachingQuality: normalizeModelRef(source.defaults?.teachingQuality, providers, defaultModelApiConfig.defaults.teachingQuality),
    },
  };
}

export function modelRefLabel(config: ModelApiConfig, ref: ModelRef) {
  const provider = config.providers.find((item) => item.id === ref.providerId);
  return provider ? `${ref.model} | ${provider.name}` : ref.model;
}

export function providerForModelRef(config: ModelApiConfig, ref: ModelRef) {
  return config.providers.find((provider) => provider.id === ref.providerId) || config.providers[0];
}

function normalizeModelApiProvider(value: unknown, index: number): ModelApiProvider {
  const provider = (value && typeof value === "object" ? value : {}) as Partial<ModelApiProvider>;
  const type = normalizeApiProviderType(provider.type);
  const fallback = defaultModelApiConfig.providers[index] || defaultModelApiConfig.providers[0];
  const id = cleanProviderId(provider.id) || fallback.id || `provider_${index + 1}`;
  const endpointConfigs = normalizeEndpointConfigs(provider.endpointConfigs);
  const defaultChatEndpoint = normalizeApiProviderType(provider.defaultChatEndpoint || type);
  return {
    id,
    presetProviderId: cleanString(provider.presetProviderId) || undefined,
    name: cleanString(provider.name) || fallback.name || id,
    description: cleanString(provider.description) || undefined,
    type,
    defaultChatEndpoint,
    endpointConfigs,
    apiHost: cleanString(provider.apiHost) || endpointConfigs[defaultChatEndpoint]?.baseUrl || fallback.apiHost || "",
    apiKey: typeof provider.apiKey === "string" ? provider.apiKey : undefined,
    hasApiKey: Boolean(provider.hasApiKey),
    apiKeyRequired: typeof provider.apiKeyRequired === "boolean" ? provider.apiKeyRequired : defaultApiKeyRequired(id, type),
    enabled: typeof provider.enabled === "boolean" ? provider.enabled : type === "codex-oauth",
    models: normalizeModelList(provider.models).length ? normalizeModelList(provider.models) : fallback.models,
    apiFeatures: isPlainRecord(provider.apiFeatures) ? provider.apiFeatures : undefined,
    websites: normalizeProviderWebsites(provider.websites),
    catalog: isPlainRecord(provider.catalog) ? provider.catalog as ModelApiProvider["catalog"] : undefined,
  };
}

function normalizeModelRef(value: unknown, providers: ModelApiProvider[], fallback: ModelRef): ModelRef {
  const ref = (value && typeof value === "object" ? value : {}) as Partial<ModelRef>;
  const providerId = providers.some((provider) => provider.id === ref.providerId) ? String(ref.providerId) : fallback.providerId;
  const provider = providers.find((item) => item.id === providerId) || providers[0];
  const fallbackModel = provider?.models.includes(fallback.model) ? fallback.model : provider?.models[0];
  return {
    providerId: provider?.id || fallback.providerId,
    model: cleanString(ref.model) || fallbackModel || fallback.model,
  };
}

function normalizeModelList(value: unknown) {
  const raw = typeof value === "string" ? value.split(/[\n,]+/) : Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return raw
    .map((item) => cleanString(item))
    .filter((item): item is string => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function normalizeApiProviderType(value: unknown): ApiProviderType {
  if (value === "openai-compatible" || value === "openai-chat") return "openai-chat-completions";
  if (value === "openai-response") return "openai-responses";
  if (
    value === "codex-oauth" ||
    value === "openai-chat-completions" ||
    value === "openai-responses" ||
    value === "anthropic-messages" ||
    value === "google-generate-content" ||
    value === "ollama-chat"
  ) {
    return value;
  }
  return "openai-chat-completions";
}

function normalizeEndpointConfigs(value: unknown): NonNullable<ModelApiProvider["endpointConfigs"]> {
  if (!isPlainRecord(value)) return {};
  const configs: NonNullable<ModelApiProvider["endpointConfigs"]> = {};
  for (const [rawKey, rawConfig] of Object.entries(value)) {
    if (!isPlainRecord(rawConfig)) continue;
    const key = normalizeApiProviderType(rawKey);
    configs[key] = {
      baseUrl: cleanString(rawConfig.baseUrl) || undefined,
      modelsApiUrls: isPlainRecord(rawConfig.modelsApiUrls)
        ? Object.fromEntries(Object.entries(rawConfig.modelsApiUrls).flatMap(([name, url]) => {
          const cleanUrl = cleanString(url);
          return cleanUrl ? [[name, cleanUrl]] : [];
        }))
        : undefined,
      reasoningFormatType: cleanString(rawConfig.reasoningFormatType) || undefined,
      adapterFamily: cleanString(rawConfig.adapterFamily) || undefined,
    };
  }
  return configs;
}

function normalizeProviderWebsites(value: unknown): ModelApiProvider["websites"] {
  if (!isPlainRecord(value)) return undefined;
  const websites = {
    official: cleanString(value.official) || undefined,
    docs: cleanString(value.docs) || undefined,
    apiKey: cleanString(value.apiKey) || undefined,
    models: cleanString(value.models) || undefined,
  };
  return Object.values(websites).some(Boolean) ? websites : undefined;
}

function defaultApiKeyRequired(providerId: string, type: ApiProviderType) {
  if (type === "codex-oauth" || type === "ollama-chat") return false;
  return !["ollama", "lmstudio", "ovms"].includes(providerId);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanProviderId(value: unknown) {
  return cleanString(value)?.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "";
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}
