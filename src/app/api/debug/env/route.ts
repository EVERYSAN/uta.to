// src/app/api/debug/env/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasKey: Boolean(process.env.YOUTUBE_API_KEY), // true なら OK
    nodeEnv: process.env.NODE_ENV,
  });
}
