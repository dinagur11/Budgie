-- CreateTable
CREATE TABLE "ReceiptScan" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReceiptScan_userId_day_idx" ON "ReceiptScan"("userId", "day");

-- AddForeignKey
ALTER TABLE "ReceiptScan" ADD CONSTRAINT "ReceiptScan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
