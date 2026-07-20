import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import prismaClient from "@prisma/client";

const { PrismaClient } = prismaClient;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(projectRoot, ".env") });
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const prisma = new PrismaClient({ adapter });

const categories = [
  ["Программирование", "programming"],
  ["История", "history"],
  ["Наука", "science"],
  ["Музыка", "music"],
  ["Кино", "cinema"],
  ["Спорт", "sport"],
  ["Другое", "other"],
];

async function main() {
  for (const [name, slug] of categories) {
    await prisma.category.upsert({
      where: { slug },
      update: { name },
      create: { name, slug },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
