// 取自 @deepseek-ai/dsh-llm lib/types/error.js 的 HarnessError（MIT），只保留这一个类，
// 避免为了一个基类把整个 dsh-llm 打进插件。
export class HarnessError extends Error {
  /** Stable machine-routable failure class (e.g. `INVALID_ARGS`). */
  code;
  constructor(message, code, options) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
}