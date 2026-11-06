import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { validateKeyAccessInput, validateKeyQuotaInput } from "@/shared/utils/keyAccess.js";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      isActive,
      access,
      maxInputTokens,
      maxOutputTokens,
      usedInputTokens,
      usedOutputTokens,
      resetUsage,
      expiresAt,
    } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "Name must be a non-empty string" }, { status: 400 });
      }
      updateData.name = name.trim();
    }
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (access !== undefined) {
      const checked = validateKeyAccessInput(access);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      updateData.access = checked.value;
    }

    const quotaChecked = validateKeyQuotaInput({
      maxInputTokens,
      maxOutputTokens,
      usedInputTokens,
      usedOutputTokens,
      resetUsage,
      expiresAt,
    });
    if (!quotaChecked.ok) {
      return NextResponse.json({ error: quotaChecked.error }, { status: 400 });
    }
    Object.assign(updateData, quotaChecked.value);

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
