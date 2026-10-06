// src/errors.js
export class CliError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
