export class CachedVersionProbe {
  private pending?: Promise<string>;

  constructor(private readonly load: () => Promise<string>) {}

  get(): Promise<string> {
    this.pending ??= this.load();
    return this.pending;
  }
}
