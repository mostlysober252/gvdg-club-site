import type { D1Like, D1ResultLike, D1StatementLike } from "../src/db.js";

class RetryableD1LossStatement implements D1StatementLike {
  bind(..._values: unknown[]): D1StatementLike {
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    throw new Error("Network connection lost");
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    throw new Error("Network connection lost");
  }

  async run(): Promise<D1ResultLike> {
    throw new Error("Network connection lost");
  }
}

export function retryableD1LossDb(): D1Like {
  return { prepare: () => new RetryableD1LossStatement() };
}
