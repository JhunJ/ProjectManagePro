-- CreateTable
CREATE TABLE "UserProjectFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserProjectFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProjectFavorite_userId_projectId_key" ON "UserProjectFavorite"("userId", "projectId");

-- CreateIndex
CREATE INDEX "UserProjectFavorite_userId_idx" ON "UserProjectFavorite"("userId");

-- CreateIndex
CREATE INDEX "UserProjectFavorite_projectId_idx" ON "UserProjectFavorite"("projectId");

-- AddForeignKey
ALTER TABLE "UserProjectFavorite" ADD CONSTRAINT "UserProjectFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProjectFavorite" ADD CONSTRAINT "UserProjectFavorite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
