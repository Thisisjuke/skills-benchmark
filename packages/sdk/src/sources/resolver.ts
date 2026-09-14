import { SkillbenchError } from "../errors";
import { silentLogger, type Logger } from "../logging";
import type { ResolvedSkill } from "../skills";
import type {
  NamedSource,
  NamedSourceStore,
  ResolvedSkillStore,
  ResolveOptions,
  SkillSourceCapabilities,
  SkillSourceResolver,
} from "./source";
import { skillSourceCapabilitiesSchema } from "./source";

const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const transientResolvedSkills: ResolvedSkillStore = {
  save: (resolvedSkill) => resolvedSkill,
};

const noNamedSources: NamedSourceStore = {
  findByAlias: () => undefined,
  listNamed: () => [],
  setAlias: () => {
    throw new SkillbenchError("Named sources require a NamedSourceStore adapter", {
      code: "SOURCE_STORE_UNAVAILABLE",
    });
  },
};

export type SkillSourceServiceOptions = {
  resolvedSkills?: ResolvedSkillStore;
  namedSources?: NamedSourceStore;
  logger?: Logger;
};

export class SkillSourceService {
  private readonly snapshots: ResolvedSkillStore;
  private readonly sources: NamedSourceStore;
  private readonly logger: Logger;

  constructor(
    private readonly resolvers: readonly SkillSourceResolver[],
    options: SkillSourceServiceOptions = {},
  ) {
    this.snapshots = options.resolvedSkills ?? transientResolvedSkills;
    this.sources = options.namedSources ?? noNamedSources;
    this.logger = options.logger ?? silentLogger;
  }

  async resolve(input: string, options: ResolveOptions = {}): Promise<ResolvedSkill> {
    const named = this.sources.findByAlias(input);
    const originalInput = named?.originalInput ?? input;
    return this.resolveDirect(originalInput, options);
  }

  async addAlias(alias: string, input: string, options: ResolveOptions = {}): Promise<NamedSource> {
    if (!ALIAS_PATTERN.test(alias)) {
      throw new SkillbenchError(
        "Source alias must be 1-64 characters using letters, numbers, dot, underscore or hyphen",
        { code: "SOURCE_ALIAS_INVALID" },
      );
    }
    if (this.sources.findByAlias(input) !== undefined) {
      throw new SkillbenchError(
        "Aliases must point directly to a local or GitHub source, not another alias",
        {
          code: "SOURCE_ALIAS_CHAIN",
        },
      );
    }
    const resolved = await this.resolveDirect(input, options);
    return this.sources.setAlias(resolved.snapshot.id, alias);
  }

  listNamed(): NamedSource[] {
    return this.sources.listNamed();
  }

  capabilities(input: string): SkillSourceCapabilities {
    const named = this.sources.findByAlias(input);
    return skillSourceCapabilitiesSchema.parse(
      this.resolverFor(named?.originalInput ?? input).capabilities,
    );
  }

  private async resolveDirect(input: string, options: ResolveOptions): Promise<ResolvedSkill> {
    const resolver = this.resolverFor(input);
    this.logger.debug("source.resolve.start", {
      resolver: resolver.constructor.name,
      offline: options.offline === true,
    });
    const resolved = await resolver.resolve(input, options);
    const persisted = this.snapshots.save(resolved);
    this.logger.debug("source.resolve.complete", {
      origin: persisted.snapshot.origin.type,
      snapshotId: persisted.snapshot.id,
      fingerprint: persisted.snapshot.fingerprint,
      fileCount: persisted.snapshot.files.length,
      resolvedCommit: persisted.snapshot.repository?.resolvedCommit,
    });
    return persisted;
  }

  private resolverFor(input: string): SkillSourceResolver {
    const resolver = this.resolvers.find((candidate) => candidate.supports(input));
    if (resolver === undefined) {
      throw new SkillbenchError(`Unsupported skill source: ${input}`, {
        code: "SOURCE_UNSUPPORTED",
      });
    }
    return resolver;
  }
}
