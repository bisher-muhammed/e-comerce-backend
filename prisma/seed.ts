import "dotenv/config";
import argon2 from "argon2";

import prisma from "../src/config/prisma";

const createSuperAdmin = async () => {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be defined"
    );
  }

  const existingSuperAdmin = await prisma.user.findFirst({
    where: {
      role: "SUPER_ADMIN",
    },
  });

  if (existingSuperAdmin) {
    console.log(
      `SUPER_ADMIN already exists: ${existingSuperAdmin.email}`
    );

    return;
  }

  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (existingUser) {
    throw new Error(
      `A user with email ${email} already exists`
    );
  }

  const passwordHash = await argon2.hash(password);

  const superAdmin = await prisma.user.create({
    data: {
      email,
      firstName: "Super",
      lastName: "Admin",
      role: "SUPER_ADMIN",
      status: "ACTIVE",

      credential: {
        create: {
          passwordHash,
        },
      },
    },

    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
    },
  });

  console.log(
    "SUPER_ADMIN created successfully:"
  );

  console.log(superAdmin);
};

createSuperAdmin()
  .catch((error) => {
    console.error(
      "Failed to create SUPER_ADMIN:",
      error
    );

    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });