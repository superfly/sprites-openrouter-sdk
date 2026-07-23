type OperationKind = "read" | "mutation";

interface PendingOperation<T> {
  kind: OperationKind;
  operation: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export class MutationScheduler {
  readonly #parallel: boolean;
  readonly #queue: PendingOperation<unknown>[] = [];
  readonly #idleWaiters: Array<() => void> = [];
  #activeReaders = 0;
  #activeMutation = false;
  #activeParallel = 0;

  constructor(mode: "serialize-mutations" | "parallel") {
    this.#parallel = mode === "parallel";
  }

  run<T>(kind: OperationKind, operation: () => Promise<T>): Promise<T> {
    if (this.#parallel) {
      this.#activeParallel += 1;
      return operation().finally(() => {
        this.#activeParallel -= 1;
        this.#notifyIdle();
      });
    }

    return new Promise<T>((resolve, reject) => {
      this.#queue.push({
        kind,
        operation,
        resolve: resolve as PendingOperation<unknown>["resolve"],
        reject,
      });
      this.#drain();
    });
  }

  async idle(): Promise<void> {
    if (this.#isIdle()) return;
    await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  #drain(): void {
    if (this.#activeMutation) return;

    const first = this.#queue[0];
    if (!first) {
      this.#notifyIdle();
      return;
    }

    if (first.kind === "mutation") {
      if (this.#activeReaders > 0) return;
      this.#queue.shift();
      this.#activeMutation = true;
      this.#start(first, () => {
        this.#activeMutation = false;
      });
      return;
    }

    while (this.#queue[0]?.kind === "read" && !this.#activeMutation) {
      const read = this.#queue.shift();
      if (!read) break;
      this.#activeReaders += 1;
      this.#start(read, () => {
        this.#activeReaders -= 1;
      });
    }
  }

  #start(operation: PendingOperation<unknown>, finish: () => void): void {
    void operation
      .operation()
      .then(operation.resolve, operation.reject)
      .finally(() => {
        finish();
        this.#drain();
        this.#notifyIdle();
      });
  }

  #isIdle(): boolean {
    return (
      this.#queue.length === 0 &&
      this.#activeReaders === 0 &&
      !this.#activeMutation &&
      this.#activeParallel === 0
    );
  }

  #notifyIdle(): void {
    if (!this.#isIdle()) return;
    for (const resolve of this.#idleWaiters.splice(0)) resolve();
  }
}
