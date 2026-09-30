/*! Copyright (c) 2026 DeepSeek
 * SPDX-License-Identifier: MIT
 * Excerpt of HarnessError from @deepseek-ai/dsh-llm (DSH Desktop 2.0.13, 0.1.5-rc.2).
 * Upstream: https://github.com/deepseek-ai/deepseek-harness
 * Full license text: ./LICENSE — keep this notice with every copy.
 */
// 只保留 HarnessError，避免为了一个基类把整个 dsh-llm 打进插件。
export class HarnessError extends Error {
  /** Stable machine-routable failure class (e.g. `INVALID_ARGS`). */
  code;
  constructor(message, code, options) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
}