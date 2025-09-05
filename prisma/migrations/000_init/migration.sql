-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."Creator" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupportEvent" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 1,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Video" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformVideoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "durationSec" INTEGER,
    "channelTitle" TEXT NOT NULL DEFAULT '',
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "creatorId" TEXT,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "supportCount" INTEGER NOT NULL DEFAULT 0,
    "supportPoints" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StatsSnapshot" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "bookmarks" INTEGER,

    CONSTRAINT "StatsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VideoMetric" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VideoMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Creator_platform_platformUserId_key" ON "public"."Creator"("platform", "platformUserId");

-- CreateIndex
CREATE INDEX "SupportEvent_videoId_createdAt_idx" ON "public"."SupportEvent"("videoId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportEvent_videoId_ipHash_createdAt_idx" ON "public"."SupportEvent"("videoId", "ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "Video_publishedAt_idx" ON "public"."Video"("publishedAt");

-- CreateIndex
CREATE INDEX "Video_views_idx" ON "public"."Video"("views");

-- CreateIndex
CREATE INDEX "Video_likes_idx" ON "public"."Video"("likes");

-- CreateIndex
CREATE UNIQUE INDEX "Video_platform_platformVideoId_key" ON "public"."Video"("platform", "platformVideoId");

-- CreateIndex
CREATE INDEX "VideoMetric_date_idx" ON "public"."VideoMetric"("date");

-- CreateIndex
CREATE UNIQUE INDEX "VideoMetric_videoId_date_key" ON "public"."VideoMetric"("videoId", "date");

-- AddForeignKey
ALTER TABLE "public"."SupportEvent" ADD CONSTRAINT "SupportEvent_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "public"."Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Video" ADD CONSTRAINT "Video_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "public"."Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StatsSnapshot" ADD CONSTRAINT "StatsSnapshot_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "public"."Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VideoMetric" ADD CONSTRAINT "VideoMetric_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "public"."Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

