import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const ModelChoiceSchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    provider: NonEmptyString,
    contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
    reasoning: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const AgentSummarySchema = Type.Object(
  {
    id: NonEmptyString,
    name: Type.Optional(NonEmptyString),
    identity: Type.Optional(
      Type.Object(
        {
          name: Type.Optional(NonEmptyString),
          theme: Type.Optional(NonEmptyString),
          emoji: Type.Optional(NonEmptyString),
          avatar: Type.Optional(NonEmptyString),
          avatarUrl: Type.Optional(NonEmptyString),
        },
        { additionalProperties: false },
      ),
    ),
    workspace: Type.Optional(NonEmptyString),
    model: Type.Optional(
      Type.Object(
        {
          primary: Type.Optional(NonEmptyString),
          fallbacks: Type.Optional(Type.Array(NonEmptyString)),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const AgentsListParamsSchema = Type.Object({}, { additionalProperties: false });

export const AgentsListResultSchema = Type.Object(
  {
    defaultId: NonEmptyString,
    mainKey: NonEmptyString,
    scope: Type.Union([Type.Literal("per-sender"), Type.Literal("global")]),
    agents: Type.Array(AgentSummarySchema),
  },
  { additionalProperties: false },
);

export const AgentsCreateParamsSchema = Type.Object(
  {
    name: NonEmptyString,
    workspace: NonEmptyString,
    emoji: Type.Optional(Type.String()),
    avatar: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AgentsCreateResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    agentId: NonEmptyString,
    name: NonEmptyString,
    workspace: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AgentsUpdateParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    name: Type.Optional(NonEmptyString),
    workspace: Type.Optional(NonEmptyString),
    model: Type.Optional(NonEmptyString),
    avatar: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AgentsUpdateResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    agentId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AgentsDeleteParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    deleteFiles: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const AgentsDeleteResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    agentId: NonEmptyString,
    removedBindings: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const AgentsFileEntrySchema = Type.Object(
  {
    name: NonEmptyString,
    path: NonEmptyString,
    missing: Type.Boolean(),
    size: Type.Optional(Type.Integer({ minimum: 0 })),
    updatedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    content: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AgentsFilesListParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AgentsFilesListResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    workspace: NonEmptyString,
    files: Type.Array(AgentsFileEntrySchema),
  },
  { additionalProperties: false },
);

export const AgentsFilesGetParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    name: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AgentsFilesGetResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    workspace: NonEmptyString,
    file: AgentsFileEntrySchema,
  },
  { additionalProperties: false },
);

export const AgentsFilesSetParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    name: NonEmptyString,
    content: Type.String(),
  },
  { additionalProperties: false },
);

export const AgentsFilesSetResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    agentId: NonEmptyString,
    workspace: NonEmptyString,
    file: AgentsFileEntrySchema,
  },
  { additionalProperties: false },
);

export const ModelsListParamsSchema = Type.Object({}, { additionalProperties: false });

export const ModelsListResultSchema = Type.Object(
  {
    models: Type.Array(ModelChoiceSchema),
  },
  { additionalProperties: false },
);

export const SkillsStatusParamsSchema = Type.Object(
  {
    agentId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const SkillsBinsParamsSchema = Type.Object({}, { additionalProperties: false });

export const SkillsBinsResultSchema = Type.Object(
  {
    bins: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

export const SkillsInstallParamsSchema = Type.Union([
  Type.Object(
    {
      name: NonEmptyString,
      installId: NonEmptyString,
      dangerouslyForceUnsafeInstall: Type.Optional(Type.Boolean()),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1000 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      source: Type.Literal("clawhub"),
      slug: NonEmptyString,
      version: Type.Optional(NonEmptyString),
      force: Type.Optional(Type.Boolean()),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1000 })),
    },
    { additionalProperties: false },
  ),
]);

export const SkillsUpdateParamsSchema = Type.Union([
  Type.Object(
    {
      skillKey: NonEmptyString,
      enabled: Type.Optional(Type.Boolean()),
      apiKey: Type.Optional(Type.String()),
      env: Type.Optional(Type.Record(NonEmptyString, Type.String())),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      source: Type.Literal("clawhub"),
      slug: Type.Optional(NonEmptyString),
      all: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
]);

export const SkillsSearchParamsSchema = Type.Object(
  {
    query: Type.Optional(NonEmptyString),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export const SkillsSearchResultSchema = Type.Object(
  {
    results: Type.Array(
      Type.Object(
        {
          score: Type.Number(),
          slug: NonEmptyString,
          displayName: NonEmptyString,
          summary: Type.Optional(Type.String()),
          version: Type.Optional(NonEmptyString),
          updatedAt: Type.Optional(Type.Integer()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const SkillsDetailParamsSchema = Type.Object(
  {
    slug: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SkillsDetailResultSchema = Type.Object(
  {
    skill: Type.Union([
      Type.Object(
        {
          slug: NonEmptyString,
          displayName: NonEmptyString,
          summary: Type.Optional(Type.String()),
          tags: Type.Optional(Type.Record(NonEmptyString, Type.String())),
          createdAt: Type.Integer(),
          updatedAt: Type.Integer(),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    latestVersion: Type.Optional(
      Type.Union([
        Type.Object(
          {
            version: NonEmptyString,
            createdAt: Type.Integer(),
            changelog: Type.Optional(Type.String()),
          },
          { additionalProperties: false },
        ),
        Type.Null(),
      ]),
    ),
    metadata: Type.Optional(
      Type.Union([
        Type.Object(
          {
            os: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
            systems: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
          },
          { additionalProperties: false },
        ),
        Type.Null(),
      ]),
    ),
    owner: Type.Optional(
      Type.Union([
        Type.Object(
          {
            handle: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
            displayName: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
            image: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          },
          { additionalProperties: false },
        ),
        Type.Null(),
      ]),
    ),
  },
  { additionalProperties: false },
);

export const SkillHubListParamsSchema = Type.Object(
  {
    query: Type.Optional(Type.String()),
    scope: Type.Optional(
      Type.Union([
        Type.Literal("discover"),
        Type.Literal("installed"),
        Type.Literal("uploads"),
        Type.Literal("updates"),
      ]),
    ),
    sort: Type.Optional(
      Type.Union([
        Type.Literal("recent"),
        Type.Literal("installs"),
        Type.Literal("likes"),
        Type.Literal("az"),
      ]),
    ),
    category: Type.Optional(
      Type.Union([
        Type.Literal("all"),
        Type.Literal("knowledge"),
        Type.Literal("automation"),
        Type.Literal("utility"),
        Type.Literal("other"),
      ]),
    ),
  },
  { additionalProperties: false },
);

const SkillHubExamplePromptsSchema = Type.Array(Type.String({ maxLength: 200 }), {
  maxItems: 3,
});

const SkillHubWarningFlagsSchema = Type.Object(
  {
    hasHiddenFiles: Type.Boolean(),
    hasExecutableFiles: Type.Boolean(),
  },
  { additionalProperties: false },
);

const SkillHubCategorySchema = Type.Union([
  Type.Literal("knowledge"),
  Type.Literal("automation"),
  Type.Literal("utility"),
  Type.Literal("other"),
]);

const SkillHubResolvedPresentationSchema = Type.Object(
  {
    displayName: NonEmptyString,
    displayDescription: Type.String(),
    category: SkillHubCategorySchema,
    icon: Type.Object(
      {
        source: Type.Union([Type.Literal("uploaded"), Type.Literal("category_default")]),
        assetUrl: Type.Optional(NonEmptyString),
        fallbackKey: SkillHubCategorySchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const WorkspacePublishStateSchema = Type.Union([
  Type.Literal("new_local_skill"),
  Type.Literal("update_available_from_local"),
  Type.Literal("up_to_date"),
  Type.Literal("existing_skill_non_owner"),
  Type.Literal("conflict_or_unknown"),
]);

export const SkillHubWorkspacePublishListParamsSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const SkillHubWorkspacePublishListResultSchema = Type.Object(
  {
    entries: Type.Array(
      Type.Object(
        {
          skillName: NonEmptyString,
          skillKey: NonEmptyString,
          description: Type.String(),
          matchedHubSlug: Type.Optional(NonEmptyString),
          hubVersion: Type.Optional(NonEmptyString),
          ownerAccountId: Type.Optional(NonEmptyString),
          installedFromHub: Type.Boolean(),
          localChecksum: Type.Optional(NonEmptyString),
          hubChecksum: Type.Optional(NonEmptyString),
          flags: Type.Optional(SkillHubWarningFlagsSchema),
          state: WorkspacePublishStateSchema,
          actionLabel: NonEmptyString,
          disabled: Type.Boolean(),
          reason: NonEmptyString,
        },
        { additionalProperties: false },
      ),
    ),
    overview: Type.Object(
      {
        sharedSkillCount: Type.Integer({ minimum: 0 }),
        updateAvailableCount: Type.Integer({ minimum: 0 }),
        localSkillCount: Type.Integer({ minimum: 0 }),
        installedSkillCount: Type.Integer({ minimum: 0 }),
        recentUpdates: Type.Array(
          Type.Object(
            {
              slug: NonEmptyString,
              displayName: NonEmptyString,
              latestVersion: NonEmptyString,
              updatedAt: NonEmptyString,
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const SkillHubListResultSchema = Type.Object(
  {
    entries: Type.Array(
      Type.Object(
        {
          slug: NonEmptyString,
          displayName: NonEmptyString,
          summary: Type.String(),
          presentation: SkillHubResolvedPresentationSchema,
          uploaderName: NonEmptyString,
          uploaderEmployeeId: NonEmptyString,
          latestVersion: NonEmptyString,
          publishedAt: NonEmptyString,
          updatedAt: NonEmptyString,
          installCount: Type.Integer({ minimum: 0 }),
          installerCount: Type.Integer({ minimum: 0 }),
          likeCount: Type.Integer({ minimum: 0 }),
          hidden: Type.Boolean(),
          uploadedByYou: Type.Boolean(),
          likedByYou: Type.Boolean(),
          installed: Type.Boolean(),
          canEditMetadata: Type.Boolean(),
          canManageVisibility: Type.Boolean(),
          canAdminManage: Type.Boolean(),
          canTransferOwnership: Type.Boolean(),
          installedVersion: Type.Optional(NonEmptyString),
          updateAvailable: Type.Boolean(),
          flags: SkillHubWarningFlagsSchema,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const SkillHubDetailParamsSchema = Type.Object(
  {
    slug: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SkillHubDetailResultSchema = Type.Object(
  {
    detail: Type.Union([
      Type.Object(
        {
          slug: NonEmptyString,
          displayName: NonEmptyString,
          summary: Type.String(),
          presentation: SkillHubResolvedPresentationSchema,
          sourceDescription: Type.Optional(Type.String()),
          presentationEdit: Type.Object(
            {
              displayName: Type.Optional(Type.String({ maxLength: 80 })),
              displayDescription: Type.Optional(Type.String({ maxLength: 100 })),
              category: Type.Optional(SkillHubCategorySchema),
              revision: Type.Integer({ minimum: 0 }),
              updatedAt: Type.Optional(NonEmptyString),
            },
            { additionalProperties: false },
          ),
          uploaderName: NonEmptyString,
          uploaderEmployeeId: NonEmptyString,
          latestVersion: NonEmptyString,
          publishedAt: NonEmptyString,
          updatedAt: NonEmptyString,
          installCount: Type.Integer({ minimum: 0 }),
          installerCount: Type.Integer({ minimum: 0 }),
          likeCount: Type.Integer({ minimum: 0 }),
          hidden: Type.Boolean(),
          uploadedByYou: Type.Boolean(),
          likedByYou: Type.Boolean(),
          installed: Type.Boolean(),
          canEditMetadata: Type.Boolean(),
          canManageVisibility: Type.Boolean(),
          canAdminManage: Type.Boolean(),
          canTransferOwnership: Type.Boolean(),
          installedVersion: Type.Optional(NonEmptyString),
          updateAvailable: Type.Boolean(),
          flags: SkillHubWarningFlagsSchema,
          examplePrompts: SkillHubExamplePromptsSchema,
          versions: Type.Array(
            Type.Object(
              {
                version: NonEmptyString,
                uploadedBy: Type.Object(
                  {
                    employeeId: NonEmptyString,
                    name: Type.Optional(NonEmptyString),
                  },
                  { additionalProperties: false },
                ),
                uploadedAt: NonEmptyString,
                path: NonEmptyString,
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

const SkillHubPublishPresentationDraftSchema = Type.Object(
  {
    displayName: Type.Optional(Type.Union([Type.String({ maxLength: 80 }), Type.Null()])),
    displayDescription: Type.Optional(Type.Union([Type.String({ maxLength: 100 }), Type.Null()])),
    category: Type.Optional(Type.Union([SkillHubCategorySchema, Type.Null()])),
    iconUpload: Type.Optional(
      Type.Object(
        {
          mimeType: Type.Literal("image/png"),
          dataBase64: NonEmptyString,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const SkillHubPublishParamsSchema = Type.Object(
  {
    skillName: NonEmptyString,
    intent: Type.Union([Type.Literal("create"), Type.Literal("update")]),
    expectedSlug: Type.Optional(NonEmptyString),
    expectedLocalChecksum: NonEmptyString,
    expectedHubChecksum: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    examplePrompts: Type.Optional(SkillHubExamplePromptsSchema),
    presentation: Type.Optional(SkillHubPublishPresentationDraftSchema),
  },
  { additionalProperties: false },
);

export const SkillHubUploadParamsSchema = Type.Object(
  {
    filename: NonEmptyString,
    contentBase64: NonEmptyString,
    expectedHubChecksum: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    examplePrompts: Type.Optional(SkillHubExamplePromptsSchema),
    presentation: Type.Optional(SkillHubPublishPresentationDraftSchema),
  },
  { additionalProperties: false },
);

const SkillHubIconOrphanSchema = Type.Object(
  {
    assetId: NonEmptyString,
    filename: NonEmptyString,
    modifiedAt: NonEmptyString,
    ageMs: Type.Number({ minimum: 0 }),
    sizeBytes: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const SkillHubIconIssueSchema = Type.Object(
  {
    filename: NonEmptyString,
    reason: Type.Union([
      Type.Literal("invalid_filename"),
      Type.Literal("hash_mismatch"),
      Type.Literal("invalid_png"),
    ]),
    assetId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const SkillHubIconAuditParamsSchema = Type.Object({}, { additionalProperties: false });

export const SkillHubIconAuditResultSchema = Type.Object(
  {
    referencedAssetIds: Type.Array(NonEmptyString),
    invalidReferencedAssetIds: Type.Array(NonEmptyString),
    assetCount: Type.Integer({ minimum: 0 }),
    orphanAssets: Type.Array(SkillHubIconOrphanSchema),
    missingAssetIds: Type.Array(NonEmptyString),
    issues: Type.Array(SkillHubIconIssueSchema),
  },
  { additionalProperties: false },
);

export const SkillHubIconGcParamsSchema = Type.Object(
  {
    dryRun: Type.Optional(Type.Boolean()),
    graceDays: Type.Optional(Type.Number({ minimum: 0, maximum: 3650 })),
  },
  { additionalProperties: false },
);

export const SkillHubIconGcResultSchema = Type.Intersect([
  SkillHubIconAuditResultSchema,
  Type.Object(
    {
      dryRun: Type.Boolean(),
      graceDays: Type.Number({ minimum: 0 }),
      deleteCandidates: Type.Array(SkillHubIconOrphanSchema),
      deletedAssetIds: Type.Array(NonEmptyString),
    },
    { additionalProperties: false },
  ),
]);

export const SkillHubHideParamsSchema = Type.Object(
  {
    slug: NonEmptyString,
    hidden: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const SkillHubInstallParamsSchema = Type.Object(
  {
    slug: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SkillHubDeleteParamsSchema = Type.Object(
  {
    slug: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SkillHubMutationResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    slug: NonEmptyString,
    version: Type.Optional(NonEmptyString),
    liked: Type.Optional(Type.Boolean()),
    likeCount: Type.Optional(Type.Integer({ minimum: 0 })),
    examplePrompts: Type.Optional(SkillHubExamplePromptsSchema),
    message: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SkillHubLikeParamsSchema = Type.Object(
  {
    slug: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SkillHubExamplePromptsUpdateParamsSchema = Type.Object(
  {
    slug: NonEmptyString,
    examplePrompts: SkillHubExamplePromptsSchema,
  },
  { additionalProperties: false },
);

export const SkillHubMetadataUpdateParamsSchema = Type.Object(
  {
    slug: NonEmptyString,
    summary: Type.String({ maxLength: 220 }),
    examplePrompts: SkillHubExamplePromptsSchema,
  },
  { additionalProperties: false },
);

export const SkillHubPresentationUpdateParamsSchema = Type.Object(
  {
    slug: NonEmptyString,
    expectedRevision: Type.Integer({ minimum: 0 }),
    displayName: Type.Union([Type.String({ maxLength: 80 }), Type.Null()]),
    displayDescription: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
    category: Type.Union([SkillHubCategorySchema, Type.Null()]),
    examplePrompts: SkillHubExamplePromptsSchema,
    iconChange: Type.Optional(
      Type.Union([
        Type.Object(
          {
            action: Type.Literal("upload"),
            mimeType: Type.Literal("image/png"),
            dataBase64: Type.String({ minLength: 4, maxLength: 350_000 }),
          },
          { additionalProperties: false },
        ),
        Type.Object({ action: Type.Literal("reset") }, { additionalProperties: false }),
      ]),
    ),
  },
  { additionalProperties: false },
);

export const SkillsDeleteParamsSchema = Type.Object(
  {
    skillKey: NonEmptyString,
    slug: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const SkillsDeleteResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    kind: Type.Union([Type.Literal("hub"), Type.Literal("workspace")]),
    skillKey: Type.Optional(NonEmptyString),
    slug: Type.Optional(NonEmptyString),
    message: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ToolsCatalogParamsSchema = Type.Object(
  {
    agentId: Type.Optional(NonEmptyString),
    includePlugins: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const ToolsEffectiveParamsSchema = Type.Object(
  {
    agentId: Type.Optional(NonEmptyString),
    sessionKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ToolCatalogProfileSchema = Type.Object(
  {
    id: Type.Union([
      Type.Literal("minimal"),
      Type.Literal("coding"),
      Type.Literal("messaging"),
      Type.Literal("full"),
    ]),
    label: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ToolCatalogEntrySchema = Type.Object(
  {
    id: NonEmptyString,
    label: NonEmptyString,
    description: Type.String(),
    source: Type.Union([Type.Literal("core"), Type.Literal("plugin")]),
    pluginId: Type.Optional(NonEmptyString),
    optional: Type.Optional(Type.Boolean()),
    defaultProfiles: Type.Array(
      Type.Union([
        Type.Literal("minimal"),
        Type.Literal("coding"),
        Type.Literal("messaging"),
        Type.Literal("full"),
      ]),
    ),
  },
  { additionalProperties: false },
);

export const ToolCatalogGroupSchema = Type.Object(
  {
    id: NonEmptyString,
    label: NonEmptyString,
    source: Type.Union([Type.Literal("core"), Type.Literal("plugin")]),
    pluginId: Type.Optional(NonEmptyString),
    tools: Type.Array(ToolCatalogEntrySchema),
  },
  { additionalProperties: false },
);

export const ToolsCatalogResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    profiles: Type.Array(ToolCatalogProfileSchema),
    groups: Type.Array(ToolCatalogGroupSchema),
  },
  { additionalProperties: false },
);

export const ToolsEffectiveEntrySchema = Type.Object(
  {
    id: NonEmptyString,
    label: NonEmptyString,
    description: Type.String(),
    rawDescription: Type.String(),
    source: Type.Union([Type.Literal("core"), Type.Literal("plugin"), Type.Literal("channel")]),
    pluginId: Type.Optional(NonEmptyString),
    channelId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const ToolsEffectiveGroupSchema = Type.Object(
  {
    id: Type.Union([Type.Literal("core"), Type.Literal("plugin"), Type.Literal("channel")]),
    label: NonEmptyString,
    source: Type.Union([Type.Literal("core"), Type.Literal("plugin"), Type.Literal("channel")]),
    tools: Type.Array(ToolsEffectiveEntrySchema),
  },
  { additionalProperties: false },
);

export const ToolsEffectiveResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    profile: NonEmptyString,
    groups: Type.Array(ToolsEffectiveGroupSchema),
  },
  { additionalProperties: false },
);
