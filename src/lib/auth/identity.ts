export class IdentityScope {
  private owner: string | null = null;
  private generation = 0;
  private readonly pending = new Set<AbortController>();
  constructor(private readonly clearCaches: () => void) {}
  get epoch() { return this.generation; }
  get userId() { return this.owner; }
  commit(epoch: number, apply: () => void): boolean {
    if (epoch !== this.generation || this.owner === null) return false;
    apply(); return true;
  }
  transition(owner: string | null, force = false) {
    if (owner === this.owner && !force) return;
    this.owner = owner; this.generation++;
    for (const controller of this.pending) controller.abort();
    this.pending.clear(); this.clearCaches();
  }
  capture() {
    const epoch = this.generation;
    const controller = new AbortController(); this.pending.add(controller);
    return {
      signal: controller.signal, current: () => epoch === this.generation && !controller.signal.aborted,
      release: () => this.pending.delete(controller),
    };
  }
}
