import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { validateKeyAccessInput, validateKeyQuotaInput } from "@/shared/utils/keyAccess.js";
import { withDailyKeySpend } from "@/lib/db/repos/keySpendRepo.js";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys: await Promise.all(keys.map(withDailyKeySpend)) });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, access, maxInputTokens, maxOutputTokens, expiresAt, dailyLimitUsd } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const options = {};
    if (access !== undefined) {
      const checked = validateKeyAccessInput(access);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      options.access = checked.value;
    }

    const quotaChecked = validateKeyQuotaInput({ maxInputTokens, maxOutputTokens, expiresAt, dailyLimitUsd });
    if (!quotaChecked.ok) {
      return NextResponse.json({ error: quotaChecked.error }, { status: 400 });
    }
    Object.assign(options, quotaChecked.value);

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name.trim(), machineId, options);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      apiKey,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
