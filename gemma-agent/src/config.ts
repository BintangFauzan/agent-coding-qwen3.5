export const OLLAMA_CONFIG = {
  enabled: false,
  apiKey: "",
  baseURL: "http://localhost:11434",
  model: "qwen_3.5:latest",
  options: {
    temperature: 0.35,
    num_ctx: 12288,
    num_predict: 4096,
  },
};

export const OPENROUTER_CONFIG = {
  enabled: true,
  apiKey: "",
  baseURL: "https://openrouter.ai/api/v1",
  model: "poolside/laguna-m.1:free",
  options: {
    temperature: 0.35,
    max_tokens: 4096,
  },
};
