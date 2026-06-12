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
    apiKey: "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",
    baseURL: "https://openrouter.ai/api/v1",
    model: "poolside/laguna-m.1:free",
    options: {
        temperature: 0.35,
        max_tokens: 4096,
    },
};
