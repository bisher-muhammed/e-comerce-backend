import argon2 from "argon2";

import prisma from "../../config/prisma";
import AppError from "../../errors/AppError";
import { CreateAdminInput } from "../../validations/admin.validation";

export const createAdmin = async (
  data: CreateAdminInput
) => {
  const {
    firstName,
    lastName,
    email,
    password,
  } = data;

  // 1. Check whether the email is already registered
  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (existingUser) {
    throw new AppError(
      "Email is already registered",
      409
    );
  }

  // 2. Hash the password
  const passwordHash = await argon2.hash(password);

  // 3. Create admin account
  const admin = await prisma.user.create({
    data: {
      firstName,
      lastName: lastName ?? null,
      email,
      role: "ADMIN",
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
      createdAt: true,
      updatedAt: true,
    },
  });

  return admin;
};

export const listAdmins = async ()=>{
  return prisma.user.findMany({
    where:{
      role:"ADMIN",
    },
    select:{
      id:true,
      email:true,
      firstName:true,
      lastName:true,
      role:true,
      status:true,
      createdAt:true,
      updatedAt:true,
    },
    orderBy:{
      createdAt:"desc",
    },

  })
}

export const getAdminById = async (
  id:number
)=>{
  const admin = await prisma.user.findFirst({
    where:{
      id,
      role:"ADMIN",

    },
    select:{
      id:true,
      email:true,
      firstName:true,
      lastName:true,
      role:true,
      status:true,
      createdAt:true,
      updatedAt:true,
    },
  });
  if(!admin){
    throw new AppError("Admin not found",404)
  }
  return admin
}


