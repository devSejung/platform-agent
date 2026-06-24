import { Type } from "@sinclair/typebox";

export const DashboardRangeSchema = Type.Union([
  Type.Literal("today"),
  Type.Literal("7d"),
  Type.Literal("30d"),
  Type.Literal("total"),
]);

export const DashboardSortBySchema = Type.Union([
  Type.Literal("name"),
  Type.Literal("part"),
  Type.Literal("agent"),
  Type.Literal("sessions"),
  Type.Literal("apiCalls"),
  Type.Literal("totalTokens"),
  Type.Literal("lastUsedAt"),
]);

export const DashboardSortDirSchema = Type.Union([Type.Literal("asc"), Type.Literal("desc")]);

export const DashboardSummaryParamsSchema = Type.Object(
  {
    range: DashboardRangeSchema,
    sortBy: Type.Optional(DashboardSortBySchema),
    sortDir: Type.Optional(DashboardSortDirSchema),
  },
  { additionalProperties: false },
);
